use super::traits::{Tool, ToolResult};
use crate::security::policy::ToolOperation;
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;

/// Append a timestamped, optionally tagged note to the agent's persistent
/// memory notes file.
///
/// Output is hard-coded to `<workspace>/ariadne/memory/notes.md`.
/// The tool never reads from or writes to any path outside that single file.
/// Each note is appended with a UTC timestamp so the history is preserved.
///
/// # Security
/// - Path is not accepted from model input — it is always the fixed file above.
/// - Gated by the existing `SecurityPolicy` (autonomy level + rate limiter).
pub struct WriteMemoryTool {
    security: Arc<SecurityPolicy>,
}

impl WriteMemoryTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }

    /// Absolute path of the notes file within the workspace.
    fn notes_path(&self) -> PathBuf {
        self.security
            .workspace_dir
            .join("ariadne")
            .join("memory")
            .join("notes.md")
    }
}

#[async_trait]
impl Tool for WriteMemoryTool {
    fn name(&self) -> &str {
        "write_memory"
    }

    fn description(&self) -> &str {
        "Append a timestamped note to the agent's persistent memory file (ariadne/memory/notes.md). \
         Optionally tag the note for later filtering. Each call appends — existing notes are never \
         overwritten. Use for observations, decisions, preferences, or reminders that should persist \
         across sessions."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The note to append. Plain text or Markdown."
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional list of tags for categorisation (e.g. [\"decision\", \"project-x\"])."
                }
            },
            "required": ["text"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let text = args
            .get("text")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'text' parameter"))?;

        let text = text.trim();
        if text.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("text must not be empty".into()),
            });
        }

        // Collect optional tags
        let tags: Vec<String> = args
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t.as_str())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();

        if let Err(err) = self
            .security
            .enforce_tool_operation(ToolOperation::Act, "write_memory")
        {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(err),
            });
        }

        let notes_path = self.notes_path();

        // Ensure the parent directory exists
        if let Some(parent) = notes_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let ts = chrono::Utc::now().to_rfc3339();
        let tag_str = if tags.is_empty() {
            String::new()
        } else {
            format!(" [{}]", tags.join(", "))
        };

        let entry = format!("\n\n---\n**{}**{}\n\n{}\n", ts, tag_str, text);

        // Append-only: never truncate existing content
        use tokio::io::AsyncWriteExt as _;
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&notes_path)
            .await?;
        file.write_all(entry.as_bytes()).await?;

        Ok(ToolResult {
            success: true,
            output: format!(
                "Note appended to {} ({} bytes)",
                notes_path.display(),
                entry.len()
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
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));
        assert_eq!(tool.name(), "write_memory");
        let schema = tool.parameters_schema();
        assert!(schema["properties"]["text"].is_object());
        assert!(schema["properties"]["tags"].is_object());
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&json!("text")));
        // tags is optional — must NOT appear in required
        assert!(!required.contains(&json!("tags")));
    }

    #[tokio::test]
    async fn appends_note_creates_file_in_ariadne_memory() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({"text": "First observation"}))
            .await
            .unwrap();
        assert!(result.success, "unexpected error: {:?}", result.error);

        let expected_path = tmp.path().join("ariadne/memory/notes.md");
        let content = tokio::fs::read_to_string(&expected_path).await.unwrap();
        assert!(content.contains("First observation"));
        assert!(content.contains("---")); // separator
    }

    #[tokio::test]
    async fn includes_tags_in_entry() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));

        tool.execute(json!({"text": "Decided to use SQLite", "tags": ["decision", "db"]}))
            .await
            .unwrap();

        let content =
            tokio::fs::read_to_string(tmp.path().join("ariadne/memory/notes.md"))
                .await
                .unwrap();
        assert!(content.contains("decision"));
        assert!(content.contains("db"));
        assert!(content.contains("Decided to use SQLite"));
    }

    #[tokio::test]
    async fn appends_multiple_notes() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));

        tool.execute(json!({"text": "Note A"})).await.unwrap();
        tool.execute(json!({"text": "Note B"})).await.unwrap();

        let content =
            tokio::fs::read_to_string(tmp.path().join("ariadne/memory/notes.md"))
                .await
                .unwrap();
        assert!(content.contains("Note A"));
        assert!(content.contains("Note B"));
    }

    #[tokio::test]
    async fn blocked_in_readonly_mode() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(readonly(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({"text": "should be blocked"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("read-only mode"));
        assert!(!tmp.path().join("ariadne/memory/notes.md").exists());
    }

    #[tokio::test]
    async fn blocked_when_rate_limited() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(rate_limited(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({"text": "should be blocked"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Rate limit"));
        assert!(!tmp.path().join("ariadne/memory/notes.md").exists());
    }

    #[tokio::test]
    async fn empty_text_rejected() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool.execute(json!({"text": "  "})).await.unwrap();
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap_or("").contains("empty"));
    }

    #[tokio::test]
    async fn missing_text_param_is_error() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));
        let result = tool.execute(json!({})).await;
        assert!(result.is_err());
    }
}


