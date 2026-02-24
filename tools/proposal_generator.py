"""
ProposalGeneratorTool — decompose a task description into a structured proposal.

Produces a JSON-serialisable dict with title, phases, resources, and
validation gates.  The output mirrors the schema expected by
ValidationWorkflowTool and is also written to the memory backend via the
write_memory / propose_change Rust tools when running inside the ZeroClaw
runtime.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class ProposalGeneratorTool:
    """Generate structured change proposals from a natural-language task."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, task_description: str) -> Dict[str, Any]:
        """
        Parse *task_description* and produce a structured proposal.

        Args:
            task_description: Free-text description of the work to be done.

        Returns:
            A dict with keys:
            - ``title`` (str): Short title derived from the first sentence.
            - ``phases`` (list[dict]): Ordered execution phases, each with
              ``name``, ``steps``, and ``outputs``.
            - ``resources`` (list[str]): Inferred resource requirements.
            - ``validation_gates`` (list[str]): Checkpoints for correctness.
            - ``generated_at`` (str): ISO-8601 UTC timestamp.

        Raises:
            ValueError: If *task_description* is empty or whitespace-only.
        """
        if not task_description or not task_description.strip():
            raise ValueError("task_description must not be empty")

        description = task_description.strip()
        title = self._extract_title(description)

        return {
            "title": title,
            "phases": self._build_phases(description),
            "resources": self._infer_resources(description),
            "validation_gates": self._build_validation_gates(title),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_title(self, description: str) -> str:
        """Use the first sentence (up to 80 chars) as the proposal title."""
        first_sentence = re.split(r"[.!?\n]", description)[0].strip()
        return first_sentence[:80] if first_sentence else description[:80]

    def _build_phases(self, description: str) -> List[Dict[str, Any]]:
        """Return a standard three-phase execution plan."""
        return [
            {
                "name": "Analysis",
                "steps": [
                    "Review task description and clarify scope.",
                    "Identify dependencies and constraints.",
                    "Document assumptions.",
                ],
                "outputs": ["scope_document"],
            },
            {
                "name": "Execution",
                "steps": [
                    "Implement the changes described in the task.",
                    "Write or update tests covering new behaviour.",
                    "Commit with a descriptive message.",
                ],
                "outputs": ["implementation", "tests"],
            },
            {
                "name": "Validation",
                "steps": [
                    "Run the relevant test suite.",
                    "Confirm all validation gates pass.",
                    "Peer-review or self-review the diff.",
                ],
                "outputs": ["validation_report"],
            },
        ]

    def _infer_resources(self, description: str) -> List[str]:
        """Return a basic resource list; extend with NLP for richer inference."""
        resources: List[str] = ["repository_access", "test_runner"]
        lower = description.lower()
        if any(kw in lower for kw in ("database", "sqlite", "postgres", "mysql")):
            resources.append("database_access")
        if any(kw in lower for kw in ("api", "http", "rest", "endpoint")):
            resources.append("network_access")
        if any(kw in lower for kw in ("file", "read", "write", "disk")):
            resources.append("filesystem_access")
        return resources

    def _build_validation_gates(self, title: str) -> List[str]:
        """Return standard validation checkpoints."""
        return [
            f"All tests pass after implementing: {title}",
            "No regressions in existing test suite.",
            "Output matches expected schema.",
            "No security-policy violations detected.",
        ]
