use super::traits::{Tool, ToolResult};
use crate::security::policy::ToolOperation;
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;

/// Write a configuration change proposal to the operator staging directory.
///
/// The agent calls this tool to *propose* changes to Ariadne's identity,
/// operational baseline, or companion mode configuration files. The proposal is
/// written as a plain Markdown file under `ariadne/proposals/` in the workspace
/// and **never** applied automatically. An operator must review and manually
/// apply approved proposals.
///
/// Proposal files are named with a UTC timestamp and a short slug derived from
/// the `target` field (e.g. `2024-03-01T12:00:00Z-core-identity.md`).
pub struct ProposeConfigChangeTool {
    security: Arc<SecurityPolicy>,
}

impl ProposeConfigChangeTool {
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

/// Allowed proposal targets.  Only these symbolic names are accepted so the
/// agent cannot propose changes to arbitrary system paths.
const ALLOWED_TARGETS: &[&str] = &[
    "core-identity",
    "operational-baseline",
    "companion-mode",
    "guardrails",
    "state-machine",
];

fn is_allowed_target(target: &str) -> bool {
    ALLOWED_TARGETS.contains(&target)
}

#[async_trait]
impl Tool for ProposeConfigChangeTool {
    fn name(&self) -> &str {
        "propose_config_change"
    }

    fn description(&self) -> &str {
        "Propose a change to an Ariadne configuration file. Writes the proposal to ariadne/proposals/ for operator review. The proposal is NEVER applied automatically — a human operator must approve and apply it. Allowed targets: core-identity, operational-baseline, companion-mode, guardrails, state-machine."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "description": "The configuration section to propose changes for. Allowed values: core-identity, operational-baseline, companion-mode, guardrails, state-machine.",
                    "enum": ["core-identity", "operational-baseline", "companion-mode", "guardrails", "state-machine"]
                },
                "rationale": {
                    "type": "string",
                    "description": "Explanation of why this change is proposed and what problem it solves."
                },
                "proposed_content": {
                    "type": "string",
                    "description": "The proposed new content or patch description. Plain text or unified diff."
                }
            },
            "required": ["target", "rationale", "proposed_content"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let target = args
            .get("target")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'target' parameter"))?;

        let rationale = args
            .get("rationale")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'rationale' parameter"))?;

        let proposed_content = args
            .get("proposed_content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'proposed_content' parameter"))?;

        // Validate target against the allowlist
        if !is_allowed_target(target) {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Unknown proposal target '{target}'. Allowed: {}",
                    ALLOWED_TARGETS.join(", ")
                )),
            });
        }

        if rationale.trim().is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Rationale must not be empty".into()),
            });
        }

        if proposed_content.trim().is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Proposed content must not be empty".into()),
            });
        }

        if let Err(err) = self
            .security
            .enforce_tool_operation(ToolOperation::Act, "propose_config_change")
        {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(err),
            });
        }

        let proposals_dir = self.proposals_dir();
        tokio::fs::create_dir_all(&proposals_dir).await?;

        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
        let filename = format!("{timestamp}-{target}.md");
        let proposal_path = proposals_dir.join(&filename);

        let proposal_content = format!(
            "# Config Change Proposal: {target}\n\n\
             **Status**: PENDING OPERATOR REVIEW\n\
             **Proposed at**: {timestamp}\n\
             **Target**: `{target}`\n\n\
             ## Rationale\n\n\
             {rationale}\n\n\
             ## Proposed Content\n\n\
             {proposed_content}\n\n\
             ---\n\
             *This proposal was generated by the agent. It must be reviewed and manually \
             applied by an operator. No automatic changes are made.*\n"
        );

        tokio::fs::write(&proposal_path, &proposal_content).await?;

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
        let tool = ProposeConfigChangeTool::new(supervised(tmp.path().to_path_buf()));
        assert_eq!(tool.name(), "propose_config_change");
        let schema = tool.parameters_schema();
        assert!(schema["properties"]["target"].is_object());
        assert!(schema["properties"]["rationale"].is_object());
        assert!(schema["properties"]["proposed_content"].is_object());
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&json!("target")));
        assert!(required.contains(&json!("rationale")));
        assert!(required.contains(&json!("proposed_content")));
    }

    #[tokio::test]
    async fn creates_proposal_file() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeConfigChangeTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "target": "core-identity",
                "rationale": "Add resilience attribute",
                "proposed_content": "## Resilience\n\nAriadne adapts under uncertainty."
            }))
            .await
            .unwrap();

        assert!(result.success, "unexpected error: {:?}", result.error);
        assert!(result.output.contains("Proposal written to"));
        assert!(result.output.contains("awaiting operator review"));

        // Verify at least one proposal file exists
        let proposals_dir = tmp.path().join("ariadne/proposals");
        let mut entries = tokio::fs::read_dir(&proposals_dir).await.unwrap();
        let entry = entries.next_entry().await.unwrap().unwrap();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        assert!(name.contains("core-identity"));
        assert!(name.ends_with(".md"));

        let content = tokio::fs::read_to_string(entry.path()).await.unwrap();
        assert!(content.contains("Add resilience attribute"));
        assert!(content.contains("PENDING OPERATOR REVIEW"));
        assert!(content.contains("must be reviewed"));
    }

    #[tokio::test]
    async fn rejects_unknown_target() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeConfigChangeTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "target": "../../etc/passwd",
                "rationale": "evil",
                "proposed_content": "bad"
            }))
            .await
            .unwrap();

        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Unknown proposal target"));
        // No proposal files should have been created
        assert!(!tmp.path().join("ariadne/proposals").exists());
    }

    #[tokio::test]
    async fn rejects_empty_rationale() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeConfigChangeTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "target": "core-identity",
                "rationale": "   ",
                "proposed_content": "some change"
            }))
            .await
            .unwrap();

        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Rationale must not be empty"));
    }

    #[tokio::test]
    async fn blocked_in_readonly_mode() {
        let tmp = TempDir::new().unwrap();
        let tool = ProposeConfigChangeTool::new(readonly(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "target": "operational-baseline",
                "rationale": "test rationale",
                "proposed_content": "test content"
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
        let tool = ProposeConfigChangeTool::new(rate_limited(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({
                "target": "companion-mode",
                "rationale": "test",
                "proposed_content": "test"
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

    #[test]
    fn allowed_targets_are_all_valid() {
        for target in ALLOWED_TARGETS {
            assert!(is_allowed_target(target), "target should be allowed: {target}");
        }
    }

    #[test]
    fn disallowed_targets_rejected() {
        for bad in &["/etc/passwd", "../../escape", "shell", "memory_store", ""] {
            assert!(
                !is_allowed_target(bad),
                "target should NOT be allowed: {bad}"
            );
        }
    }
}
