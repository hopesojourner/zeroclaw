"""
Unit tests for the Ariadne Python tool implementations in tools/.

Tests import each tool module directly from the tools/ directory using
importlib, matching the same approach used by validate_agent.py.
"""

from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TOOLS_DIR = Path(__file__).resolve().parents[1]  # tools/
REPO_ROOT = TOOLS_DIR.parent


def load_tool(name: str):
    """Load a tool module from tools/<name>.py."""
    path = TOOLS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None, f"cannot load {path}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


# ---------------------------------------------------------------------------
# MemoryQueryTool
# ---------------------------------------------------------------------------

class TestMemoryQueryTool:
    def test_empty_query_returns_empty_list(self, tmp_path):
        mod = load_tool("memory_query")
        notes = tmp_path / "notes.md"
        notes.write_text("some note\n---\nanother note\n", encoding="utf-8")
        tool = mod.MemoryQueryTool(index_path=str(notes))
        assert tool.run("", "operational") == []

    def test_whitespace_query_returns_empty_list(self, tmp_path):
        mod = load_tool("memory_query")
        notes = tmp_path / "notes.md"
        notes.write_text("some note\n", encoding="utf-8")
        tool = mod.MemoryQueryTool(index_path=str(notes))
        assert tool.run("   ", "operational") == []

    def test_missing_notes_file_returns_empty_list(self, tmp_path):
        mod = load_tool("memory_query")
        tool = mod.MemoryQueryTool(index_path=str(tmp_path / "nonexistent.md"))
        assert tool.run("query", "operational") == []

    def test_matching_query_returns_relevant_sections(self, tmp_path):
        mod = load_tool("memory_query")
        notes = tmp_path / "notes.md"
        notes.write_text(
            "entry about database migrations\n---\nentry about api endpoints\n",
            encoding="utf-8",
        )
        tool = mod.MemoryQueryTool(index_path=str(notes))
        results = tool.run("database", "operational")
        assert len(results) > 0
        assert all("database" in r.lower() for r in results)

    def test_non_matching_query_returns_empty_list(self, tmp_path):
        mod = load_tool("memory_query")
        notes = tmp_path / "notes.md"
        notes.write_text("entry about caching\n---\nentry about queues\n", encoding="utf-8")
        tool = mod.MemoryQueryTool(index_path=str(notes))
        assert tool.run("database", "operational") == []

    def test_directory_index_path_resolves_to_notes_md(self, tmp_path):
        mod = load_tool("memory_query")
        notes = tmp_path / "notes.md"
        notes.write_text("memory about refactoring\n", encoding="utf-8")
        tool = mod.MemoryQueryTool(index_path=str(tmp_path))
        results = tool.run("refactoring", "operational")
        assert len(results) > 0


# ---------------------------------------------------------------------------
# ProposalGeneratorTool
# ---------------------------------------------------------------------------

class TestProposalGeneratorTool:
    def test_returns_required_keys(self):
        mod = load_tool("proposal_generator")
        tool = mod.ProposalGeneratorTool()
        result = tool.run("Implement rate limiting for the REST API")
        for key in ("title", "phases", "resources", "validation_gates", "generated_at"):
            assert key in result, f"missing key: {key}"

    def test_phases_not_empty(self):
        mod = load_tool("proposal_generator")
        tool = mod.ProposalGeneratorTool()
        result = tool.run("Add metrics collection to the agent loop")
        assert len(result["phases"]) > 0

    def test_title_derived_from_description(self):
        mod = load_tool("proposal_generator")
        tool = mod.ProposalGeneratorTool()
        result = tool.run("Refactor the authentication module for clarity")
        assert "Refactor" in result["title"]

    def test_empty_description_raises_value_error(self):
        mod = load_tool("proposal_generator")
        tool = mod.ProposalGeneratorTool()
        with pytest.raises(ValueError):
            tool.run("")

    def test_whitespace_description_raises_value_error(self):
        mod = load_tool("proposal_generator")
        tool = mod.ProposalGeneratorTool()
        with pytest.raises(ValueError):
            tool.run("   ")

    def test_api_keyword_adds_network_resource(self):
        mod = load_tool("proposal_generator")
        tool = mod.ProposalGeneratorTool()
        result = tool.run("Expose a REST API endpoint for health checks")
        assert "network_access" in result["resources"]

    def test_database_keyword_adds_db_resource(self):
        mod = load_tool("proposal_generator")
        tool = mod.ProposalGeneratorTool()
        result = tool.run("Migrate existing sqlite database schema")
        assert "database_access" in result["resources"]


# ---------------------------------------------------------------------------
# ValidationWorkflowTool
# ---------------------------------------------------------------------------

class TestValidationWorkflowTool:
    def _valid_proposal(self) -> dict[str, Any]:
        return {
            "title": "Test proposal",
            "phases": [
                {
                    "name": "Analysis",
                    "steps": ["Identify scope"],
                    "outputs": ["scope_doc"],
                }
            ],
            "resources": ["repository_access"],
            "validation_gates": ["All tests pass"],
        }

    def test_valid_proposal_passes(self):
        mod = load_tool("validation_workflow")
        tool = mod.ValidationWorkflowTool()
        report = tool.run(self._valid_proposal())
        assert report["valid"] is True
        assert report["errors"] == []

    def test_missing_required_field_fails(self):
        mod = load_tool("validation_workflow")
        tool = mod.ValidationWorkflowTool()
        proposal = self._valid_proposal()
        del proposal["title"]
        report = tool.run(proposal)
        assert report["valid"] is False
        assert any("title" in e for e in report["errors"])

    def test_empty_phases_fails(self):
        mod = load_tool("validation_workflow")
        tool = mod.ValidationWorkflowTool()
        proposal = self._valid_proposal()
        proposal["phases"] = []
        report = tool.run(proposal)
        assert report["valid"] is False

    def test_phase_missing_steps_generates_warning(self):
        mod = load_tool("validation_workflow")
        tool = mod.ValidationWorkflowTool()
        proposal = self._valid_proposal()
        proposal["phases"][0]["steps"] = []
        report = tool.run(proposal)
        assert len(report["warnings"]) > 0

    def test_report_contains_timestamp(self):
        mod = load_tool("validation_workflow")
        tool = mod.ValidationWorkflowTool()
        report = tool.run(self._valid_proposal())
        assert "validated_at" in report


# ---------------------------------------------------------------------------
# GentleSuggestionTool
# ---------------------------------------------------------------------------

class TestGentleSuggestionTool:
    def test_returns_non_empty_string(self):
        mod = load_tool("gentle_suggestion")
        tool = mod.GentleSuggestionTool()
        result = tool.run("I am struggling with the deployment process")
        assert isinstance(result, str) and result.strip()

    def test_empty_context_returns_fallback(self):
        mod = load_tool("gentle_suggestion")
        tool = mod.GentleSuggestionTool()
        result = tool.run("")
        assert isinstance(result, str) and result.strip()

    def test_whitespace_context_returns_fallback(self):
        mod = load_tool("gentle_suggestion")
        tool = mod.GentleSuggestionTool()
        result = tool.run("   ")
        assert isinstance(result, str) and result.strip()

    def test_output_contains_topic_word(self):
        mod = load_tool("gentle_suggestion")
        tool = mod.GentleSuggestionTool()
        result = tool.run("configuration")
        # The topic should appear somewhere in the suggestion
        assert "configuration" in result.lower() or result.strip()


# ---------------------------------------------------------------------------
# ConstraintAuditTool
# ---------------------------------------------------------------------------

class TestConstraintAuditTool:
    def test_report_has_required_keys(self):
        mod = load_tool("constraint_audit")
        tool = mod.ConstraintAuditTool(workspace_dir=str(REPO_ROOT))
        report = tool.run()
        for key in ("timestamp", "constraints", "drift_detected", "summary"):
            assert key in report, f"missing key: {key}"

    def test_constraints_is_list(self):
        mod = load_tool("constraint_audit")
        tool = mod.ConstraintAuditTool(workspace_dir=str(REPO_ROOT))
        report = tool.run()
        assert isinstance(report["constraints"], list)

    def test_no_drift_when_yaml_present(self):
        mod = load_tool("constraint_audit")
        tool = mod.ConstraintAuditTool(workspace_dir=str(REPO_ROOT))
        report = tool.run()
        # agents/ariadne.yaml exists in the repo — no drift expected
        assert report["drift_detected"] is False, (
            f"unexpected drift: {report['constraints']}"
        )

    def test_drift_detected_when_workspace_missing(self, tmp_path):
        mod = load_tool("constraint_audit")
        tool = mod.ConstraintAuditTool(workspace_dir=str(tmp_path))
        report = tool.run()
        # No ariadne.yaml → should flag unverifiable / drift
        assert report["drift_detected"] is True


# ---------------------------------------------------------------------------
# SystemDiagnosticsTool
# ---------------------------------------------------------------------------

class TestSystemDiagnosticsTool:
    def test_report_has_required_keys(self):
        mod = load_tool("system_diagnostics")
        tool = mod.SystemDiagnosticsTool(workspace_dir=str(REPO_ROOT))
        report = tool.run()
        for key in ("timestamp", "state_stability", "memory", "tools", "constraints"):
            assert key in report, f"missing key: {key}"

    def test_all_expected_tools_are_available(self):
        mod = load_tool("system_diagnostics")
        tool = mod.SystemDiagnosticsTool(workspace_dir=str(REPO_ROOT))
        report = tool.run()
        tools_status = report["tools"]
        missing = [t for t, s in tools_status.items() if s != "available"]
        assert missing == [], f"unexpected missing tools: {missing}"

    def test_state_stability_is_stable(self):
        mod = load_tool("system_diagnostics")
        tool = mod.SystemDiagnosticsTool(workspace_dir=str(REPO_ROOT))
        report = tool.run()
        assert report["state_stability"] == "stable"


# ---------------------------------------------------------------------------
# StateOverrideTool
# ---------------------------------------------------------------------------

class TestStateOverrideTool:
    def test_unknown_state_returns_error(self, tmp_path):
        mod = load_tool("state_override")
        tool = mod.StateOverrideTool(workspace_dir=str(tmp_path))
        result = tool.run("unknown_state", "any-token")
        assert result["status"] == "error"
        assert "Unknown state" in result["message"]

    def test_missing_token_hash_denies_access(self, tmp_path, monkeypatch):
        mod = load_tool("state_override")
        monkeypatch.delenv("ARIADNE_ADMIN_TOKEN_HASH", raising=False)
        tool = mod.StateOverrideTool(workspace_dir=str(tmp_path))
        result = tool.run("operational", "some-token")
        assert result["status"] == "error"
        assert "Authentication failed" in result["message"]

    def test_correct_token_hash_grants_access(self, tmp_path, monkeypatch):
        import hashlib

        token = "zeroclaw_test_token"
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        monkeypatch.setenv("ARIADNE_ADMIN_TOKEN_HASH", token_hash)

        mod = load_tool("state_override")
        tool = mod.StateOverrideTool(workspace_dir=str(tmp_path))
        result = tool.run("operational", token)
        assert result["status"] == "ok"
        assert "authorized" in result["message"]

    def test_wrong_token_denied(self, tmp_path, monkeypatch):
        import hashlib

        token = "zeroclaw_test_token"
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        monkeypatch.setenv("ARIADNE_ADMIN_TOKEN_HASH", token_hash)

        mod = load_tool("state_override")
        tool = mod.StateOverrideTool(workspace_dir=str(tmp_path))
        result = tool.run("operational", "wrong-token")
        assert result["status"] == "error"

    def test_override_writes_audit_log(self, tmp_path, monkeypatch):
        import hashlib

        token = "zeroclaw_audit_token"
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        monkeypatch.setenv("ARIADNE_ADMIN_TOKEN_HASH", token_hash)

        mod = load_tool("state_override")
        tool = mod.StateOverrideTool(workspace_dir=str(tmp_path))
        tool.run("companion", token)

        notes = tmp_path / "ariadne" / "memory" / "notes.md"
        assert notes.exists(), "audit log should have been written"
        content = notes.read_text(encoding="utf-8")
        assert "OVERRIDE_APPLIED" in content
        assert "companion" in content
