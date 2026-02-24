use super::traits::{Tool, ToolResult};
use crate::security::policy::ToolOperation;
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;

/// Write a staged change proposal for human review.
///
/// The agent calls this tool to propose changes to any Ariadne configuration,
/// prompt layer, code, or operational behaviour. The proposal is written as a
/// Markdown file under `<workspace>/ariadne/proposals/` and is **never** applied
/// automatically. A human operator must review, approve, and manually apply it.
///
/// Proposal files are named `<rfc3339-timestamp>_<slug>.md` using `create_new`
/// so an existing proposal cannot be silently overwritten.
pub struct ProposeChangeTool {
    security: Arc<SecurityPolicy>,
}

impl ProposeChangeTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }

    fn proposals_dir(&self) -> PathBuf {
        self.security
            .workspace_dir
            .join("ariadne")
            .join("proposals")
    }
}

/// Derive a URL-safe filename slug from a proposal title.
///
/// Lowercases, replaces non-alphanumeric chars with `-`, deduplicates `-`,
/// and takes at most 8 segments to keep filenames short.
fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-")
}

#[async_trait]
impl Tool for ProposeChangeTool {
    fn name(&self) -> &str {
        "propose_change"
    }

    fn description(&self) -> &str {
        "Write a change proposal to ariadne/proposals/ for operator review. \
         The proposal is NEVER applied automatically — a human operator must \
         approve and apply it. Include a unified diff, rationale, test plan, \
         and risk notes."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Short title for the proposal (used in the filename slug)."
                },
                "summary": {
                    "type": "string",
                    "description": "Human-readable explanation of what is being proposed and why."
                },
                "files": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Informational list of files affected by the proposal."
                },
                "diff": {
                    "type": "string",
                    "description": "Unified diff (patch) representing the proposed change."
                },
                "test_plan": {
                    "type": "string",
                    "description": "How the operator should verify the change is correct."
                },
                "risk": {
                    "type": "string",
                    "description": "Risk notes: what could go wrong and how to mitigate it."
                }
            },
            "required": ["title", "summary", "diff"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let title = args
            .get("title")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'title' parameter"))?
            .trim();

        let summary = args
            .get("summary")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'summary' parameter"))?
            .trim();

        let diff = args
            .get("diff")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'diff' parameter"))?
            .trim();

        if title.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("title must not be empty".into()),
            });
        }
        if summary.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("summary must not be empty".into()),
            });
        }
        if diff.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("diff must not be empty".into()),
            });
        }

        // Collect optional fields
        let files: Vec<String> = args
            .get("files")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|f| f.as_str())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();

        let test_plan = args
            .get("test_plan")
            .and_then(|v| v.as_str())
            .unwrap_or("_(not provided)_");

        let risk = args
            .get("risk")
            .and_then(|v| v.as_str())
            .unwrap_or("_(not provided)_");

        if let Err(err) = self
            .security
            .enforce_tool_operation(ToolOperation::Act, "propose_change")
        {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(err),
            });
        }

        let proposals_dir = self.proposals_dir();
        tokio::fs::create_dir_all(&proposals_dir).await?;

        let ts = chrono::Utc::now().to_rfc3339();
        // RFC 3339 colons are not safe in filenames on all platforms
        let ts_safe = ts.replace(':', "-");
        let slug = slugify(title);
        let filename = format!("{}_{}.md", ts_safe, slug);
        let proposal_path = proposals_dir.join(&filename);

        let files_md = if files.is_empty() {
            "_(not specified)_".to_string()
        } else {
            files
                .iter()
                .map(|f| format!("- {f}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let body = format!(
            "# Proposal: {title}\n\n\
             **Timestamp:** {ts}\n\
             **Status:** PENDING OPERATOR REVIEW\n\n\
             ## Summary\n\n\
             {summary}\n\n\
             ## Files (informational)\n\n\
             {files_md}\n\n\
             ## Patch (unified diff)\n\n\
             ```diff\n\
             {diff}\n\
             ```\n\n\
             ## Test Plan\n\n\
             {test_plan}\n\n\
             ## Risk / Notes\n\n\
             {risk}\n\n\
             ---\n\
             *This proposal was generated by the agent and must be reviewed and manually \
             applied by an operator. No automatic changes are made.*\n"
        );

        // create_new: fail if the file already exists (prevents overwrite)
        use tokio::io::AsyncWriteExt as _;
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&proposal_path)
            .await?;
        file.write_all(body.as_bytes()).await?;

        Ok(ToolResult {
            success: true,
            output: format!(
                "Proposal written to {} — awaiting operator review",
                proposal_path.display()
            ),
            error: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::{AutonomyLevel, SecurityPolicy};
    use tempfile::TempDir;

    fn supervised(workspace: std::path::PathBuf) -> Arc<SecurityPolicy> {
        Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::Supervised,
            workspace_dir: workspace,
            ..SecurityPolicy::default()
        })
    }

    fn readonly(workspace: std::path::PathBuf) -> Arc<SecurityPolicy> {
        Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::ReadOnly,
            workspace_dir: workspace,
            ..SecurityPolicy::default()
        })
    }

    fn rate_limited(workspace: std::path::PathBuf) -> Arc<SecurityPolicy> {
        Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::Supervised,
            workspace_dir: workspace,
            max_actions_per_hour: 0,
            ..SecurityPolicy::default()
        })
    }

    #[test]
    fn name_and_schema() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeChangeTool::new(supervised(tmp.path().to_path_buf()));
        assert_eq!(tool.name(), "propose_change");
        let schema = tool.parameters_schema();
        assert!(schema["properties"]["title"].is_object());
        assert!(schema["properties"]["summary"].is_object());
        assert!(schema["properties"]["files"].is_object());
        assert!(schema["properties"]["diff"].is_object());
        assert!(schema["properties"]["test_plan"].is_object());
        assert!(schema["properties"]["risk"].is_object());
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&json!("title")));
        assert!(required.contains(&json!("summary")));
        assert!(required.contains(&json!("diff")));
        // optional fields must not be in required
        assert!(!required.contains(&json!("files")));
        assert!(!required.contains(&json!("test_plan")));
        assert!(!required.contains(&json!("risk")));
    }

    #[tokio::test]
    async fn creates_proposal_file_with_all_fields() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeChangeTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "title": "Add resilience attribute",
                "summary": "Introduce resilience to core-identity so Ariadne adapts under uncertainty.",
                "files": ["ai/ariadne/core-identity.md"],
                "diff": "--- a/ai/ariadne/core-identity.md\n+++ b/ai/ariadne/core-identity.md\n@@ -5 +5 @@\n+- **Resilient**: Adapts calmly under uncertainty.",
                "test_plan": "Read the prompt in OPERATIONAL mode and verify no regression.",
                "risk": "Low — additive change to identity invariants."
            }))
            .await
            .unwrap();

        assert!(result.success, "unexpected error: {:?}", result.error);
        assert!(result.output.contains("awaiting operator review"));

        let proposals_dir = tmp.path().join("ariadne/proposals");
        let mut entries = tokio::fs::read_dir(&proposals_dir).await.unwrap();
        let entry = entries.next_entry().await.unwrap().unwrap();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        assert!(name_str.contains("add-resilience-attribute"));
        assert!(name_str.ends_with(".md"));

        let content = tokio::fs::read_to_string(entry.path()).await.unwrap();
        assert!(content.contains("Add resilience attribute"));
        assert!(content.contains("PENDING OPERATOR REVIEW"));
        assert!(content.contains("core-identity.md"));
        assert!(content.contains("```diff"));
        assert!(content.contains("Add resilience"));
        assert!(content.contains("No automatic changes are made"));
    }

    #[tokio::test]
    async fn creates_proposal_with_minimal_fields() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeChangeTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "title": "Tune task keywords",
                "summary": "Add 'deploy' to task indicators.",
                "diff": "+  \"deploy\","
            }))
            .await
            .unwrap();

        assert!(result.success, "unexpected error: {:?}", result.error);

        let proposals_dir = tmp.path().join("ariadne/proposals");
        let mut entries = tokio::fs::read_dir(&proposals_dir).await.unwrap();
        let entry = entries.next_entry().await.unwrap().unwrap();
        let content = tokio::fs::read_to_string(entry.path()).await.unwrap();
        assert!(content.contains("_(not provided)_"));   // test_plan
        assert!(content.contains("_(not specified)_"));  // files
    }

    #[tokio::test]
    async fn blocked_in_readonly_mode() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeChangeTool::new(readonly(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "title": "test",
                "summary": "test",
                "diff": "test"
            }))
            .await
            .unwrap();

        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("read-only mode"));
        assert!(!tmp.path().join("ariadne/proposals").exists());
    }

    #[tokio::test]
    async fn blocked_when_rate_limited() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeChangeTool::new(rate_limited(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "title": "test",
                "summary": "test",
                "diff": "test"
            }))
            .await
            .unwrap();

        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Rate limit"));
        assert!(!tmp.path().join("ariadne/proposals").exists());
    }

    #[tokio::test]
    async fn rejects_empty_title() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeChangeTool::new(supervised(tmp.path().to_path_buf()));
        let result = tool
            .execute(json!({"title": "", "summary": "s", "diff": "d"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap_or("").contains("title"));
    }

    #[tokio::test]
    async fn rejects_empty_summary() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeChangeTool::new(supervised(tmp.path().to_path_buf()));
        let result = tool
            .execute(json!({"title": "t", "summary": "  ", "diff": "d"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap_or("").contains("summary"));
    }

    #[tokio::test]
    async fn rejects_empty_diff() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeChangeTool::new(supervised(tmp.path().to_path_buf()));
        let result = tool
            .execute(json!({"title": "t", "summary": "s", "diff": ""}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap_or("").contains("diff"));
    }

    #[test]
    fn slugify_normalises_title() {
        assert_eq!(slugify("Add resilience attribute"), "add-resilience-attribute");
        assert_eq!(slugify("Fix: memory/notes path"), "fix-memory-notes-path");
        assert_eq!(slugify("  spaces  everywhere  "), "spaces-everywhere");
    }

    #[test]
    fn slugify_limits_segments() {
        let long = "one two three four five six seven eight nine ten";
        let slug = slugify(long);
        // At most 8 segments
        assert!(slug.split('-').count() <= 8);
    }
}
