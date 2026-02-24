"""
StateOverrideTool — perform an authenticated agent state transition.

Used exclusively in administrative state.  Validates an operator-supplied
auth token before switching the agent to a target state, and appends an
audit entry to the memory notes file for traceability.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

# Environment variable that holds the operator token hash (SHA-256 hex).
# Set ARIADNE_ADMIN_TOKEN_HASH in the deployment environment.
# Generate with: echo -n "<your-token>" | sha256sum
_TOKEN_HASH_ENV_VAR = "ARIADNE_ADMIN_TOKEN_HASH"

_VALID_STATES = frozenset({"operational", "companion", "administrative"})


class StateOverrideTool:
    """Perform an authenticated agent state transition with audit logging."""

    def __init__(self, workspace_dir: str = ".") -> None:
        """
        Args:
            workspace_dir: Root of the agent workspace.  Used for audit log.
        """
        self.workspace_dir = Path(workspace_dir)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, target_state: str, auth_token: str) -> Dict[str, str]:
        """
        Switch the agent to *target_state* if *auth_token* is valid.

        Args:
            target_state: One of ``"operational"``, ``"companion"``,
                          ``"administrative"``.
            auth_token: Operator-supplied secret token.

        Returns:
            A dict with ``status`` (``"ok"`` or ``"error"``) and
            ``message`` describing the outcome.
        """
        if target_state not in _VALID_STATES:
            return {
                "status": "error",
                "message": f"Unknown state '{target_state}'. "
                           f"Valid states: {sorted(_VALID_STATES)}",
            }

        if not self._validate_token(auth_token):
            self._audit("OVERRIDE_REJECTED", target_state, "invalid token")
            return {
                "status": "error",
                "message": "Authentication failed. Override rejected.",
            }

        self._audit("OVERRIDE_APPLIED", target_state, "authorized")
        return {
            "status": "ok",
            "message": f"State override to '{target_state}' authorized and logged.",
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _validate_token(self, token: str) -> bool:
        """Compare the provided token against the stored hash using HMAC."""
        expected_hash = os.environ.get(_TOKEN_HASH_ENV_VAR, "")
        if not expected_hash:
            # No hash configured — deny all overrides (fail-closed).
            return False
        supplied_hash = hashlib.sha256(token.encode()).hexdigest()
        return hmac.compare_digest(supplied_hash, expected_hash.lower())

    def _audit(self, event: str, target_state: str, outcome: str) -> None:
        """Append a tamper-evident audit entry to the memory notes file."""
        notes_dir = self.workspace_dir / "ariadne" / "memory"
        notes_dir.mkdir(parents=True, exist_ok=True)
        notes_path = notes_dir / "notes.md"
        ts = datetime.now(timezone.utc).isoformat()
        entry = (
            f"\n\n---\n**{ts}** [admin-audit]\n\n"
            f"EVENT: {event}  \nTARGET_STATE: {target_state}  \nOUTCOME: {outcome}\n"
        )
        with open(notes_path, "a", encoding="utf-8") as f:
            f.write(entry)
