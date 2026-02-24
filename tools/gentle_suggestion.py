"""
GentleSuggestionTool — generate low-stakes, supportive suggestions.

Used exclusively in companion state.  Produces warm, open-ended phrasing
that avoids analytical depth or binding commitments.
"""

from __future__ import annotations

import random
from typing import List


# Framing templates that produce non-directive, supportive suggestions.
# The {topic} placeholder is replaced with a keyword extracted from context.
_TEMPLATES: List[str] = [
    "You might find it helpful to take a moment with {topic}.",
    "When you're ready, revisiting {topic} could be worthwhile.",
    "It's okay to approach {topic} at your own pace.",
    "One small step with {topic} might open things up a bit.",
    "There's no rush — exploring {topic} when the time feels right is perfectly fine.",
    "I wonder if returning to {topic} with fresh eyes might feel different now.",
]


class GentleSuggestionTool:
    """Produce warm, low-stakes suggestions in companion state."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, context: str) -> str:
        """
        Generate a gentle, supportive suggestion based on *context*.

        Args:
            context: The current conversational or situational context.
                     Used to extract a lightweight topic keyword.

        Returns:
            A single suggestion string with warm, open-ended phrasing.
            Returns a neutral fallback if context is empty.
        """
        if not context or not context.strip():
            return "Take things one step at a time — you're doing well."

        topic = self._extract_topic(context.strip())
        template = random.choice(_TEMPLATES)
        return template.format(topic=topic)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_topic(self, context: str) -> str:
        """Return a short keyword phrase from the context string."""
        # Use the last meaningful word-group (up to 4 words) as the topic.
        words = context.split()
        if len(words) <= 4:
            return context
        return " ".join(words[-4:]).rstrip(".,;:!?")
