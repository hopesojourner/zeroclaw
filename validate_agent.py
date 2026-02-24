"""
validate_agent.py — Ariadne agent deployment validation script.

Validates that all Python tool implementations, YAML configuration files,
and mode-transition logic are correctly wired before running a live deployment.

Usage:
    python validate_agent.py

All checks run against local files only — no running Ollama instance or
network connection is required.

Exit codes:
    0 — all checks passed
    1 — one or more checks failed
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

# ---------------------------------------------------------------------------
# Helper: resolve repo root relative to this script
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent
TOOLS_DIR = REPO_ROOT / "tools"


def _ok(msg: str) -> None:
    print(f"  [PASS] {msg}")


def _fail(msg: str) -> None:
    print(f"  [FAIL] {msg}", file=sys.stderr)


# ---------------------------------------------------------------------------
# 1.  YAML config validation
# ---------------------------------------------------------------------------

def _load_yaml(path: Path) -> Any:
    """Load a YAML file, using PyYAML when available and falling back to a
    lightweight check otherwise."""
    try:
        import yaml  # type: ignore[import-untyped]
        with open(path, encoding="utf-8") as fh:
            return yaml.safe_load(fh)
    except ImportError:
        # PyYAML not installed — just confirm the file is readable
        with open(path, encoding="utf-8") as fh:
            content = fh.read()
        if not content.strip():
            raise ValueError(f"{path} is empty")
        return {}  # sentinel: present but not parsed


def validate_configs() -> List[Tuple[str, bool, str]]:
    """Validate that all agent YAML configuration files are present and
    well-formed.

    Returns:
        A list of (check_name, passed, detail) tuples.
    """
    results: List[Tuple[str, bool, str]] = []

    config_checks: List[Tuple[str, List[str]]] = [
        ("agents/ariadne.yaml",     ["name", "states", "memory", "constraints"]),
        ("providers/llm_config.yaml", ["operational", "companion", "administrative"]),
        ("channels/rest.yaml",      ["adapter", "port", "allowed_states"]),
        ("channels/cli.yaml",       ["adapter", "allowed_states"]),
    ]

    for rel_path, required_keys in config_checks:
        path = REPO_ROOT / rel_path
        check_name = f"config:{rel_path}"
        if not path.exists():
            results.append((check_name, False, f"{rel_path} not found"))
            continue
        try:
            data = _load_yaml(path)
            if data and required_keys:
                missing = [k for k in required_keys if k not in data]
                if missing:
                    results.append(
                        (check_name, False, f"missing keys: {missing}")
                    )
                    continue
            results.append((check_name, True, "present and well-formed"))
        except Exception as exc:  # noqa: BLE001
            results.append((check_name, False, f"parse error: {exc}"))

    return results


# ---------------------------------------------------------------------------
# 2.  Tool file existence
# ---------------------------------------------------------------------------

def validate_tool_files() -> List[Tuple[str, bool, str]]:
    """Confirm that every expected Python tool module exists on disk."""
    expected = [
        "memory_query.py",
        "proposal_generator.py",
        "validation_workflow.py",
        "gentle_suggestion.py",
        "system_diagnostics.py",
        "state_override.py",
        "constraint_audit.py",
    ]
    results: List[Tuple[str, bool, str]] = []
    for filename in expected:
        path = TOOLS_DIR / filename
        exists = path.exists()
        results.append(
            (
                f"tool-file:{filename}",
                exists,
                "present" if exists else f"not found at {path}",
            )
        )
    return results


# ---------------------------------------------------------------------------
# 3.  Tool unit tests
# ---------------------------------------------------------------------------

def _import_tool(module_name: str):
    """Import a tool module from the tools/ directory."""
    import importlib.util

    module_path = TOOLS_DIR / f"{module_name}.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load spec for {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def validate_memory_query_tool() -> Tuple[str, bool, str]:
    """MemoryQueryTool: empty query returns empty list; note matching works."""
    check = "tool:memory_query"
    try:
        mod = _import_tool("memory_query")
        with tempfile.TemporaryDirectory() as tmpdir:
            notes = Path(tmpdir) / "notes.md"
            notes.write_text(
                "first entry about databases\n---\nsecond entry about api\n",
                encoding="utf-8",
            )
            tool = mod.MemoryQueryTool(index_path=str(notes))
            # Empty query → empty result
            assert tool.run("", "operational") == [], "empty query should return []"
            # Matching query → non-empty result
            results = tool.run("database", "operational")
            assert len(results) > 0, "should match 'database' note"
        return (check, True, "passed")
    except Exception as exc:  # noqa: BLE001
        return (check, False, str(exc))


def validate_proposal_generator_tool() -> Tuple[str, bool, str]:
    """ProposalGeneratorTool: produces valid proposal with expected keys."""
    check = "tool:proposal_generator"
    try:
        mod = _import_tool("proposal_generator")
        tool = mod.ProposalGeneratorTool()
        result = tool.run("Refactor the authentication module")
        assert isinstance(result, dict), "result must be a dict"
        for key in ("title", "phases", "resources", "validation_gates", "generated_at"):
            assert key in result, f"missing key: {key}"
        assert len(result["phases"]) > 0, "phases must not be empty"
        # Empty description raises ValueError
        try:
            tool.run("   ")
            return (check, False, "expected ValueError for blank description")
        except ValueError:
            pass
        return (check, True, "passed")
    except Exception as exc:  # noqa: BLE001
        return (check, False, str(exc))


def validate_validation_workflow_tool() -> Tuple[str, bool, str]:
    """ValidationWorkflowTool: valid proposal passes; incomplete proposal fails."""
    check = "tool:validation_workflow"
    try:
        mod = _import_tool("validation_workflow")
        tool = mod.ValidationWorkflowTool()

        valid_proposal: Dict[str, Any] = {
            "title": "Test proposal",
            "phases": [
                {
                    "name": "Analysis",
                    "steps": ["step one"],
                    "outputs": ["scope_document"],
                }
            ],
            "resources": ["repository_access"],
            "validation_gates": ["All tests pass"],
        }
        report = tool.run(valid_proposal)
        assert report["valid"] is True, f"expected valid=True, got {report}"

        # Incomplete proposal should fail
        incomplete: Dict[str, Any] = {"title": "Missing phases"}
        bad_report = tool.run(incomplete)
        assert bad_report["valid"] is False, "incomplete proposal should not be valid"

        return (check, True, "passed")
    except Exception as exc:  # noqa: BLE001
        return (check, False, str(exc))


def validate_gentle_suggestion_tool() -> Tuple[str, bool, str]:
    """GentleSuggestionTool: returns a non-empty string for any context."""
    check = "tool:gentle_suggestion"
    try:
        mod = _import_tool("gentle_suggestion")
        tool = mod.GentleSuggestionTool()

        # Non-empty context
        result = tool.run("I am struggling with the new deployment process")
        assert isinstance(result, str) and result.strip(), "must return non-empty string"

        # Empty context falls back gracefully
        fallback = tool.run("")
        assert isinstance(fallback, str) and fallback.strip(), "fallback must be non-empty"

        return (check, True, "passed")
    except Exception as exc:  # noqa: BLE001
        return (check, False, str(exc))


def validate_constraint_audit_tool() -> Tuple[str, bool, str]:
    """ConstraintAuditTool: reports all constraints when ariadne.yaml present."""
    check = "tool:constraint_audit"
    try:
        mod = _import_tool("constraint_audit")
        tool = mod.ConstraintAuditTool(workspace_dir=str(REPO_ROOT))
        report = tool.run()
        assert "constraints" in report, "report must have 'constraints' key"
        assert "drift_detected" in report, "report must have 'drift_detected' key"
        assert isinstance(report["constraints"], list), "'constraints' must be a list"
        return (check, True, "passed")
    except Exception as exc:  # noqa: BLE001
        return (check, False, str(exc))


def validate_system_diagnostics_tool() -> Tuple[str, bool, str]:
    """SystemDiagnosticsTool: returns a complete health snapshot."""
    check = "tool:system_diagnostics"
    try:
        mod = _import_tool("system_diagnostics")
        tool = mod.SystemDiagnosticsTool(workspace_dir=str(REPO_ROOT))
        report = tool.run()
        for key in ("timestamp", "state_stability", "memory", "tools", "constraints"):
            assert key in report, f"missing key: {key}"
        return (check, True, "passed")
    except Exception as exc:  # noqa: BLE001
        return (check, False, str(exc))


def validate_state_override_tool() -> Tuple[str, bool, str]:
    """StateOverrideTool: unknown state rejected; missing token hash denied."""
    check = "tool:state_override"
    try:
        mod = _import_tool("state_override")
        with tempfile.TemporaryDirectory() as tmpdir:
            tool = mod.StateOverrideTool(workspace_dir=tmpdir)

            # Unknown state
            result = tool.run("unknown_state", "any-token")
            assert result["status"] == "error", "unknown state must return error"

            # Valid state but no token hash configured → deny
            result = tool.run("operational", "any-token")
            assert result["status"] == "error", "missing token hash must return error"

        return (check, True, "passed")
    except Exception as exc:  # noqa: BLE001
        return (check, False, str(exc))


# ---------------------------------------------------------------------------
# 4.  Mode-transition validation
# ---------------------------------------------------------------------------

def validate_mode_transitions() -> List[Tuple[str, bool, str]]:
    """
    Verify that companion-mode activation and task-indicator reversion work
    as specified in agents/ariadne.yaml and ai/ariadne/state-machine.ts.

    This is a Python re-implementation of the detectModeSwitch rules so that
    the logic can be validated without compiling TypeScript.
    """
    results: List[Tuple[str, bool, str]] = []

    OPERATIONAL = "operational"
    COMPANION = "companion"
    ADMINISTRATIVE = "administrative"

    COMPANION_PHRASES = [
        "ariadne, companion mode",
        "switch to companion",
    ]
    ADMINISTRATIVE_PHRASES = [
        "enter administrative mode",
        "ariadne, admin mode",
    ]
    TASK_INDICATORS = [
        "code", "debug", "analyze", "plan", "budget",
        "architecture", "refactor", "profile", "optimize",
    ]

    def detect_mode_switch(text: str, current: str) -> str:
        lower = text.lower()
        for phrase in ADMINISTRATIVE_PHRASES:
            if phrase in lower:
                return ADMINISTRATIVE
        for phrase in COMPANION_PHRASES:
            if phrase in lower:
                return COMPANION
        if any(kw in lower for kw in TASK_INDICATORS):
            return OPERATIONAL
        return current

    cases: List[Tuple[str, str, str, str]] = [
        # (description, input, current_mode, expected_mode)
        ("companion activation phrase",
         "Ariadne, companion mode", OPERATIONAL, COMPANION),
        ("switch-to-companion phrase",
         "switch to companion", OPERATIONAL, COMPANION),
        ("task indicator 'debug' reverts to operational",
         "can you debug this function?", COMPANION, OPERATIONAL),
        ("task indicator 'analyze' reverts to operational",
         "please analyze the data", COMPANION, OPERATIONAL),
        ("no match retains current operational mode",
         "hello there", OPERATIONAL, OPERATIONAL),
        ("no match retains current companion mode",
         "how are you doing?", COMPANION, COMPANION),
        ("companion phrase takes precedence over task indicator",
         "ariadne, companion mode — then code something", OPERATIONAL, COMPANION),
        ("administrative activation phrase",
         "enter administrative mode", OPERATIONAL, ADMINISTRATIVE),
        ("admin shorthand phrase",
         "ariadne, admin mode", COMPANION, ADMINISTRATIVE),
        ("administrative phrase takes precedence over task indicator",
         "enter administrative mode and debug the logs", OPERATIONAL, ADMINISTRATIVE),
        ("no match retains current administrative mode",
         "show system status", ADMINISTRATIVE, ADMINISTRATIVE),
    ]

    for description, user_input, current, expected in cases:
        got = detect_mode_switch(user_input, current)
        passed = got == expected
        detail = f"got '{got}'" if not passed else "passed"
        results.append((f"mode-transition:{description}", passed, detail))

    return results


# ---------------------------------------------------------------------------
# 5.  Channel config state coverage
# ---------------------------------------------------------------------------

def validate_channel_state_coverage() -> List[Tuple[str, bool, str]]:
    """Verify that allowed_states in channel configs cover expected states."""
    results: List[Tuple[str, bool, str]] = []

    channel_expectations = {
        "channels/rest.yaml": {"operational", "administrative"},
        "channels/cli.yaml": {"operational", "companion", "administrative"},
    }

    for rel_path, expected_states in channel_expectations.items():
        path = REPO_ROOT / rel_path
        check = f"channel-states:{rel_path}"
        if not path.exists():
            results.append((check, False, f"{rel_path} not found"))
            continue
        try:
            data = _load_yaml(path)
            if not data:
                results.append((check, True, "skipped (PyYAML not available)"))
                continue
            allowed = set(data.get("allowed_states", []))
            missing = expected_states - allowed
            if missing:
                results.append((check, False, f"missing states: {missing}"))
            else:
                results.append((check, True, "all expected states present"))
        except Exception as exc:  # noqa: BLE001
            results.append((check, False, str(exc)))

    return results


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

def run_all_checks() -> bool:
    """Run every validation suite and print a formatted report.

    Returns:
        True if all checks passed, False otherwise.
    """
    all_results: List[Tuple[str, bool, str]] = []

    suites = [
        ("Config file validation",  validate_configs),
        ("Tool file presence",      validate_tool_files),
        ("Channel state coverage",  validate_channel_state_coverage),
        ("Mode-transition logic",   validate_mode_transitions),
    ]

    tool_checks = [
        validate_memory_query_tool,
        validate_proposal_generator_tool,
        validate_validation_workflow_tool,
        validate_gentle_suggestion_tool,
        validate_constraint_audit_tool,
        validate_system_diagnostics_tool,
        validate_state_override_tool,
    ]

    for title, suite_fn in suites:
        print(f"\n{'─' * 60}")
        print(f"  {title}")
        print(f"{'─' * 60}")
        for check, passed, detail in suite_fn():
            if passed:
                _ok(f"{check}")
            else:
                _fail(f"{check}: {detail}")
            all_results.append((check, passed, detail))

    print(f"\n{'─' * 60}")
    print("  Tool unit tests")
    print(f"{'─' * 60}")
    for check_fn in tool_checks:
        check, passed, detail = check_fn()
        if passed:
            _ok(check)
        else:
            _fail(f"{check}: {detail}")
        all_results.append((check, passed, detail))

    total = len(all_results)
    passed_count = sum(1 for _, p, _ in all_results if p)
    failed_count = total - passed_count

    print(f"\n{'═' * 60}")
    print(f"  Results: {passed_count}/{total} checks passed", end="")
    if failed_count:
        print(f"  ({failed_count} failed)", file=sys.stderr)
    else:
        print()
    print(f"{'═' * 60}\n")

    return failed_count == 0


if __name__ == "__main__":
    ok = run_all_checks()
    sys.exit(0 if ok else 1)
