/**
 * Ariadne state machine.
 *
 * Mode is controlled by the application layer, not the model. The LLM is
 * never trusted to self-assign or self-change modes.
 */

export enum AriadneMode {
  OPERATIONAL = "OPERATIONAL",
  COMPANION = "COMPANION",
}

/**
 * Keywords whose presence in a user message signals task-oriented intent and
 * forces an automatic return to OPERATIONAL mode.
 *
 * Note: these are single-word indicators as specified by the seed design.
 * Activation phrases for COMPANION mode are checked first (see above), so the
 * phrase "Ariadne, companion mode" is never misclassified even though it
 * contains no task keyword. Callers that need stricter disambiguation may
 * pre-process input before calling detectModeSwitch.
 */
const TASK_INDICATORS: readonly string[] = [
  "code",
  "debug",
  "analyze",
  "plan",
  "budget",
  "architecture",
  "refactor",
  "profile",
  "optimize",
];

/**
 * Determine the next mode given a user input string and the current mode.
 *
 * Rules (evaluated in order):
 * 1. Explicit companion-mode activation phrases → COMPANION
 * 2. Task-indicator keywords present             → OPERATIONAL
 * 3. No match                                    → retain current mode
 */
export function detectModeSwitch(
  input: string,
  currentMode: AriadneMode,
): AriadneMode {
  const normalized = input.toLowerCase();

  // Explicit activation
  if (
    normalized.includes("ariadne, companion mode") ||
    normalized.includes("switch to companion")
  ) {
    return AriadneMode.COMPANION;
  }

  // Automatic deactivation if technical query appears
  if (TASK_INDICATORS.some((k) => normalized.includes(k))) {
    return AriadneMode.OPERATIONAL;
  }

  return currentMode;
}

/**
 * Structured context injected into every prompt to prevent the model from
 * needing to track state internally.
 */
export interface AriadneContext {
  mode: AriadneMode;
  projectContext?: string;
  recentTopics: string[];
}

/**
 * Render an AriadneContext into the inline CURRENT CONTEXT block that is
 * prepended to every prompt.
 */
export function formatContext(ctx: AriadneContext): string {
  const lines: string[] = [
    "CURRENT CONTEXT:",
    `- Mode: ${ctx.mode}`,
  ];

  if (ctx.projectContext) {
    lines.push(`- Active Project: ${ctx.projectContext}`);
  }

  if (ctx.recentTopics.length > 0) {
    lines.push(`- Ongoing Topics: ${ctx.recentTopics.join(", ")}`);
  }

  return lines.join("\n");
}
