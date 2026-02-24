/**
 * Ariadne state machine.
 *
 * Mode is controlled by the application layer, not the model. The LLM is
 * never trusted to self-assign or self-change modes.
 */

export enum AriadneMode {
  OPERATIONAL = "OPERATIONAL",
  COMPANION = "COMPANION",
  ADMINISTRATIVE = "ADMINISTRATIVE",
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
 * 1. Explicit administrative-mode activation phrases → ADMINISTRATIVE
 * 2. Explicit companion-mode activation phrases      → COMPANION
 * 3. Task-indicator keywords present                 → OPERATIONAL
 * 4. No match                                        → retain current mode
 */
export function detectModeSwitch(
  input: string,
  currentMode: AriadneMode,
): AriadneMode {
  const normalized = input.toLowerCase();

  // Administrative activation (evaluated first — operator intent is unambiguous)
  if (
    normalized.includes("enter administrative mode") ||
    normalized.includes("ariadne, admin mode")
  ) {
    return AriadneMode.ADMINISTRATIVE;
  }

  // Explicit companion activation
  if (
    normalized.includes("ariadne, companion mode") ||
    normalized.includes("switch to companion")
  ) {
    return AriadneMode.COMPANION;
  }

  // Reversion to operational on any task-indicator keyword
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
