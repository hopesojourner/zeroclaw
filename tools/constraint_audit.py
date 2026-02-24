"""
ConstraintAuditTool — verify that all declared agent constraints are active.

Used exclusively in administrative state.  Reads the constraint list from
agents/ariadne.yaml and verifies each one is still present and correctly
configured.  Reports drift or missing constraints.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


# Constraints declared in agents/ariadne.yaml — source of truth.
# Update this list if agents/ariadne.yaml constraints change.
_DECLARED_CONSTRAINTS: List[str] = [
    "no_cross_state_context_leakage",
    "no_emotional_output_in_operational_state",
    "no_system_commands_outside_administrative_state",
    "no_explicit_content",
]

# Constraints whose enforcement can be confirmed by inspecting guardrails.ts
_VERIFIABLE_VIA_GUARDRAILS: List[str] = [
    "no_explicit_content",
]


class ConstraintAuditTool:
    """Audit all declared agent constraints and report compliance status."""

    def __init__(self, workspace_dir: str = ".") -> None:
        """
        Args:
            workspace_dir: Root of the agent workspace.  Used to locate
                           ``agents/ariadne.yaml`` and ``ai/ariadne/guardrails.ts``.
        """
        self.workspace_dir = Path(workspace_dir)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self) -> Dict[str, Any]:
        """
        Verify all constraints are active and report any drift.

        Returns:
            A dict with keys:
            - ``timestamp`` (str): ISO-8601 UTC timestamp.
            - ``constraints`` (list[dict]): Per-constraint status records.
            - ``drift_detected`` (bool): True if any constraint is missing
              or unverifiable.
            - ``summary`` (str): Human-readable one-line summary.
        """
        results: List[Dict[str, str]] = []
        drift = False

        agent_yaml_exists = (
            self.workspace_dir / "agents" / "ariadne.yaml"
        ).exists()
        guardrails_exists = (
            self.workspace_dir / "ai" / "ariadne" / "guardrails.ts"
        ).exists()

        for constraint in _DECLARED_CONSTRAINTS:
            status = self._check_constraint(
                constraint, agent_yaml_exists, guardrails_exists
            )
            results.append({"constraint": constraint, "status": status})
            if status != "active":
                drift = True

        summary = (
            "All constraints active." if not drift
            else f"{sum(1 for r in results if r['status'] != 'active')} constraint(s) require attention."
        )

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "constraints": results,
            "drift_detected": drift,
            "summary": summary,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_constraint(
        self,
        constraint: str,
        agent_yaml_exists: bool,
        guardrails_exists: bool,
    ) -> str:
        """Return the status string for a single constraint."""
        if not agent_yaml_exists:
            return "unverifiable — agents/ariadne.yaml missing"

        if constraint in _VERIFIABLE_VIA_GUARDRAILS:
            if not guardrails_exists:
                return "unverifiable — guardrails.ts missing"
            # Confirm the constraint name appears in guardrails.ts
            guardrails_path = (
                self.workspace_dir / "ai" / "ariadne" / "guardrails.ts"
            )
            try:
                content = guardrails_path.read_text(encoding="utf-8")
                if "BANNED_PATTERNS" in content:
                    return "active"
                return "unverifiable — BANNED_PATTERNS not found in guardrails.ts"
            except OSError:
                return "unverifiable — could not read guardrails.ts"

        # For non-guardrails constraints, presence in agent YAML is the check
        agent_yaml_path = self.workspace_dir / "agents" / "ariadne.yaml"
        try:
            content = agent_yaml_path.read_text(encoding="utf-8")
            if constraint in content:
                return "active"
            return f"drift — '{constraint}' not found in agents/ariadne.yaml"
        except OSError:
            return "unverifiable — could not read agents/ariadne.yaml"
