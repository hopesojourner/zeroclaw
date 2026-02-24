use super::traits::{Tool, ToolResult};
use crate::security::policy::ToolOperation;
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;

/// Append a timestamped note to the agent's persistent memory notes file.
///
/// Writes are restricted to `memory/notes.md` within the workspace directory.
/// The tool never reads from or writes to any path outside that single file.
/// Each note is appended with a UTC timestamp so the history is preserved.
pub struct WriteMemoryTool {
    security: Arc<SecurityPolicy>,
}

impl WriteMemoryTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }

    /// Absolute path of the notes file within the workspace.
    fn notes_path(&self) -> PathBuf {
        self.security.workspace_dir.join("memory").join("notes.md")
    }
}

#[async_trait]
impl Tool for WriteMemoryTool {
    fn name(&self) -> &str {
        "write_memory"
    }

    fn description(&self) -> &str {
        "Append a note to the agent's persistent memory notes file (memory/notes.md in the workspace). Each note is timestamped and preserved. Use for observations, decisions, preferences, or reminders that should persist across sessions."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "note": {
                    "type": "string",
                    "description": "The note to append. Plain text or Markdown."
                }
            },
            "required": ["note"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let note = args
            .get("note")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'note' parameter"))?;

        if note.trim().is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Note must not be empty".into()),
            });
        }

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

        // Build the entry: UTC timestamp + note body
        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
        let entry = format!("\n## {timestamp}\n\n{note}\n");

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
        assert!(schema["properties"]["note"].is_object());
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&json!("note")));
    }

    #[tokio::test]
    async fn appends_note_and_creates_file() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({"note": "First observation"}))
            .await
            .unwrap();
        assert!(result.success, "unexpected error: {:?}", result.error);

        let content = tokio::fs::read_to_string(tmp.path().join("memory/notes.md"))
            .await
            .unwrap();
        assert!(content.contains("First observation"));
        assert!(content.contains("##")); // timestamp heading
    }

    #[tokio::test]
    async fn appends_multiple_notes() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));

        tool.execute(json!({"note": "Note A"})).await.unwrap();
        tool.execute(json!({"note": "Note B"})).await.unwrap();

        let content = tokio::fs::read_to_string(tmp.path().join("memory/notes.md"))
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
            .execute(json!({"note": "should be blocked"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("read-only mode"));
        assert!(!tmp.path().join("memory/notes.md").exists());
    }

    #[tokio::test]
    async fn blocked_when_rate_limited() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(rate_limited(tmp.path().to_path_buf()));

        let result = tool
            .execute(json!({"note": "should be blocked"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Rate limit"));
        assert!(!tmp.path().join("memory/notes.md").exists());
    }

    #[tokio::test]
    async fn empty_note_rejected() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));

        let result = tool.execute(json!({"note": "  "})).await.unwrap();
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap_or("").contains("empty"));
    }

    #[tokio::test]
    async fn missing_note_param_is_error() {
        let tmp = TempDir::new().unwrap();
        let tool = WriteMemoryTool::new(supervised(tmp.path().to_path_buf()));
        let result = tool.execute(json!({})).await;
        assert!(result.is_err());
    }
}
