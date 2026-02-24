"""
ValidationWorkflowTool — validate a structured proposal against a schema.

Checks that a proposal produced by ProposalGeneratorTool (or equivalent)
has the required fields, passes structural integrity rules, and contains
no constraint violations.  Returns a validation report dict.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List


# Required top-level keys and their expected types
_REQUIRED_FIELDS: Dict[str, type] = {
    "title": str,
    "phases": list,
    "resources": list,
    "validation_gates": list,
}

# Required keys inside each phase entry
_PHASE_REQUIRED_KEYS = {"name", "steps", "outputs"}


class ValidationWorkflowTool:
    """Validate a proposal dict against the Ariadne proposal schema."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate *proposal* and return a structured report.

        Args:
            proposal: A proposal dict as produced by ProposalGeneratorTool.

        Returns:
            A dict with keys:
            - ``valid`` (bool): True only when no errors are found.
            - ``errors`` (list[str]): Constraint or schema violations.
            - ``warnings`` (list[str]): Non-fatal observations.
            - ``validated_at`` (str): ISO-8601 UTC timestamp.
        """
        errors: List[str] = []
        warnings: List[str] = []

        self._check_required_fields(proposal, errors)
        self._check_phases(proposal.get("phases", []), errors, warnings)
        self._check_resources(proposal.get("resources", []), warnings)
        self._check_validation_gates(proposal.get("validation_gates", []), warnings)

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "validated_at": datetime.now(timezone.utc).isoformat(),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_required_fields(
        self, proposal: Dict[str, Any], errors: List[str]
    ) -> None:
        for field, expected_type in _REQUIRED_FIELDS.items():
            if field not in proposal:
                errors.append(f"Missing required field: '{field}'")
            elif not isinstance(proposal[field], expected_type):
                errors.append(
                    f"Field '{field}' must be {expected_type.__name__}, "
                    f"got {type(proposal[field]).__name__}"
                )
            elif expected_type in (list, dict) and not proposal[field]:
                errors.append(f"Field '{field}' must not be empty")

    def _check_phases(
        self, phases: Any, errors: List[str], warnings: List[str]
    ) -> None:
        if not isinstance(phases, list):
            return  # already reported in _check_required_fields
        for i, phase in enumerate(phases):
            if not isinstance(phase, dict):
                errors.append(f"Phase[{i}] must be a dict")
                continue
            missing = _PHASE_REQUIRED_KEYS - phase.keys()
            if missing:
                errors.append(f"Phase[{i}] missing keys: {sorted(missing)}")
            if not phase.get("steps"):
                warnings.append(f"Phase[{i}] ('{phase.get('name', '?')}') has no steps")

    def _check_resources(self, resources: Any, warnings: List[str]) -> None:
        if not isinstance(resources, list):
            return
        if not resources:
            warnings.append("No resources listed; verify no dependencies are missing")

    def _check_validation_gates(
        self, gates: Any, warnings: List[str]
    ) -> None:
        if not isinstance(gates, list):
            return
        if not gates:
            warnings.append("No validation gates defined; consider adding test criteria")
