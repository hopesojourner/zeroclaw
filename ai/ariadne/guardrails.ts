import { AriadneMode } from "./state-machine";

/**
 * Hard-blocked content patterns.
 *
 * Keep this list focused on genuinely prohibited categories. Prefer specific
 * multi-word phrases over single words to reduce false positives.
 */
const BANNED_PATTERNS: readonly string[] = [
  // explicit erotic anatomy (representative samples — extend as needed)
  "graphic sex act",
  "explicit sexual act",
  "pornographic content",
];

/**
 * Operational-mode tone violations.
 *
 * These phrases signal companion-mode tone leaking into task-oriented output.
 * Covers warmth, emotional support, personal connection, and romantic language
 * that must not appear in OPERATIONAL responses.
 */
const OPERATIONAL_TONE_VIOLATIONS: readonly string[] = [
  "i feel",
  "we could cuddle",
  "i love you",
  "you mean so much",
  "sending warmth",
  "gentle reminder",
  "you are doing great",
  "proud of you",
  "i'm here for you",
  "i am here for you",
  "you're not alone",
  "you are not alone",
  "holding space",
];

/**
 * Validate model output against content policy and mode-specific tone rules.
 *
 * Returns the original text when no violation is found.
 * Returns a sanitized replacement string on violation so callers can decide
 * whether to regenerate or surface the message to the user.
 */
export function validateOutput(text: string, mode: AriadneMode): string {
  const lower = text.toLowerCase();

  // Hard block: explicit content — applies in all modes
  for (const pattern of BANNED_PATTERNS) {
    if (lower.includes(pattern)) {
      return "[Content removed due to policy violation]";
    }
  }

  // Tone enforcement: companion-mode language must not leak into OPERATIONAL
  if (mode === AriadneMode.OPERATIONAL) {
    for (const violation of OPERATIONAL_TONE_VIOLATIONS) {
      if (lower.includes(violation)) {
        return "Tone violation: companion language detected in operational mode";
      }
    }
  }

  return text;
}
