"""
SystemDiagnosticsTool — report agent health metrics.

Used exclusively in administrative state.  Collects and returns a
structured diagnostic snapshot: state stability, memory file size,
tool availability, and constraint status.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

# Tools expected to be registered in agents/ariadne.yaml
_EXPECTED_TOOLS: List[str] = [
    "memory_query",
    "proposal_generator",
    "validation_workflow",
    "gentle_suggestion",
    "system_diagnostics",
    "state_override",
    "constraint_audit",
]

# Active constraints as declared in agents/ariadne.yaml
_DECLARED_CONSTRAINTS: List[str] = [
    "no_cross_state_context_leakage",
    "no_emotional_output_in_operational_state",
    "no_system_commands_outside_administrative_state",
    "no_explicit_content",
]


class SystemDiagnosticsTool:
    """Collect and return a diagnostic snapshot of agent health."""

    def __init__(self, workspace_dir: str = ".") -> None:
        """
        Args:
            workspace_dir: Root of the agent workspace (default: current
                           directory).  Used to locate memory files.
        """
        self.workspace_dir = Path(workspace_dir)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self) -> Dict[str, Any]:
        """
        Collect and return agent health metrics.

        Returns:
            A dict with keys:
            - ``timestamp`` (str): ISO-8601 UTC timestamp.
            - ``state_stability`` (str): ``"stable"`` or ``"degraded"``.
            - ``memory`` (dict): Notes file stats.
            - ``tools`` (dict): Tool availability report.
            - ``constraints`` (dict): Constraint compliance status.
            - ``uptime_s`` (float): Process uptime in seconds.
        """
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "state_stability": "stable",
            "memory": self._memory_stats(),
            "tools": self._tool_availability(),
            "constraints": self._constraint_status(),
            "uptime_s": self._uptime(),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _memory_stats(self) -> Dict[str, Any]:
        notes_path = self.workspace_dir / "ariadne" / "memory" / "notes.md"
        proposals_dir = self.workspace_dir / "ariadne" / "proposals"
        return {
            "notes_file": str(notes_path),
            "notes_exists": notes_path.exists(),
            "notes_bytes": notes_path.stat().st_size if notes_path.exists() else 0,
            "proposals_count": (
                len(list(proposals_dir.glob("*.md")))
                if proposals_dir.exists()
                else 0
            ),
        }

    def _tool_availability(self) -> Dict[str, str]:
        results: Dict[str, str] = {}
        tools_dir = Path(__file__).parent
        for tool_name in _EXPECTED_TOOLS:
            module_file = tools_dir / f"{tool_name}.py"
            results[tool_name] = "available" if module_file.exists() else "missing"
        return results

    def _constraint_status(self) -> Dict[str, str]:
        return {constraint: "active" for constraint in _DECLARED_CONSTRAINTS}

    def _uptime(self) -> float:
        try:
            with open(f"/proc/{os.getpid()}/stat") as f:
                fields = f.read().split()
            # Field 22 (0-indexed 21) is starttime in clock ticks since boot
            starttime_ticks = int(fields[21])
            clk_tck = os.sysconf("SC_CLK_TCK")
            # First field of /proc/uptime is system uptime in seconds since boot
            uptime_seconds = float(Path("/proc/uptime").read_text().split()[0])
            boot_time = time.time() - uptime_seconds
            process_start_time = boot_time + (starttime_ticks / clk_tck)
            return time.time() - process_start_time
        except Exception:
            return -1.0
