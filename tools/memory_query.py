"""
MemoryQueryTool — query the Ariadne memory index for context snippets.

Reads from the markdown notes file (ariadne/memory/notes.md) maintained by
the write_memory Rust tool.  In a production deployment, swap the simple
line-scan implementation below for a proper vector store query against the
backend configured in agents/ariadne.yaml (memory.backend).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List


class MemoryQueryTool:
    """Query the agent's persistent memory notes for relevant context."""

    def __init__(self, index_path: str) -> None:
        """
        Args:
            index_path: Path to the memory notes file or vector store index
                        directory.  Defaults to the canonical notes file used
                        by the write_memory Rust tool.
        """
        self.index_path = Path(index_path)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, query: str, state: str) -> List[str]:
        """
        Query the memory store for snippets relevant to *query*.

        Args:
            query: Natural-language or keyword search string.
            state: Current agent state (``"operational"``, ``"companion"``,
                   ``"administrative"``).  Can be used to filter results or
                   weight them by relevance to the active state.

        Returns:
            A list of matching note snippets (may be empty).
        """
        if not query or not query.strip():
            return []

        notes_file = self._resolve_notes_file()
        if not notes_file.exists():
            return []

        return self._search(notes_file, query.strip().lower())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_notes_file(self) -> Path:
        """Return the path to the notes Markdown file."""
        if self.index_path.is_dir():
            return self.index_path / "notes.md"
        return self.index_path

    def _search(self, notes_file: Path, query: str) -> List[str]:
        """Simple line-scan search.  Replace with vector query for production."""
        try:
            content = notes_file.read_text(encoding="utf-8")
        except OSError:
            return []

        # Split on the separator written by write_memory (---\n)
        sections = re.split(r"\n---\n", content)
        matches = [s.strip() for s in sections if query in s.lower()]
        return matches
