/**
 * Ariadne state machine.
 *
 * Mode is controlled by the application layer, not the model. The LLM is
 * never trusted to self-assign or self-change modes.
 */

import * as crypto from "crypto";

export enum AriadneMode {
  OPERATIONAL = "OPERATIONAL",
  COMPANION = "COMPANION",
  /**
   * Operator-level mode for auditing, configuration, and emergency operations.
   * Requires explicit authentication from the application layer.
   * Never auto-assigned by the model or via task-indicator detection.
   */
  ADMINISTRATIVE = "ADMINISTRATIVE",
}

/**
 * Immutable record of a single mode transition, for external audit logging.
 * The application layer is responsible for persisting these entries.
 */
export interface TransitionEntry {
  readonly timestamp: number;
  readonly from: AriadneMode;
  readonly to: AriadneMode;
  readonly authorized: boolean;
}

/**
 * Tool names available per mode.
 *
 * OPERATIONAL:    task-oriented tools (memory, analysis, file operations, shell).
 * COMPANION:      memory and tone tools scoped to relational interactions.
 * ADMINISTRATIVE: operator-level tools (auditing, config proposals, emergency stop).
 *
 * The application layer uses these lists to filter the tool registry exposed to
 * the LLM.  Tools are scoped to the current mode; they do not stack across modes.
 */
export const MODE_TOOLS: Readonly<Record<AriadneMode, readonly string[]>> = {
  [AriadneMode.OPERATIONAL]: [
    "memory_recall",
    "memory_store",
    "shell",
    "file_read",
    "file_edit",
    "file_write",
    "content_search",
    "glob_search",
    "http_request",
    "web_search",
  ],
  [AriadneMode.COMPANION]: [
    "memory_recall",
    "write_memory",
  ],
  [AriadneMode.ADMINISTRATIVE]: [
    "propose_config_change",
    "audit_logs",
    "estop",
  ],
};

/**
 * Return the tool names scoped to the given mode.
 */
export function getAvailableModeTools(mode: AriadneMode): readonly string[] {
  return MODE_TOOLS[mode];
}

/**
 * Attempt to elevate to ADMINISTRATIVE mode.
 *
 * The application layer calls this function; the model is never permitted to
 * invoke it directly.  Returns `AriadneMode.ADMINISTRATIVE` on a valid token or
 * `null` on failure (bad token, empty input, or length mismatch).
 *
 * @param authToken      Plaintext token supplied by the operator.
 * @param knownTokenHash Lowercase hex-encoded SHA-256 of the expected token,
 *                       stored securely by the application layer.
 */
export function switchToAdminMode(
  authToken: string,
  knownTokenHash: string,
): AriadneMode | null {
  if (!authToken || !knownTokenHash) {
    return null;
  }

  // SHA-256 hex digest is always exactly 64 lowercase hex characters.
  if (!/^[0-9a-f]{64}$/.test(knownTokenHash.toLowerCase())) {
    return null;
  }

  const actualHash = crypto
    .createHash("sha256")
    .update(authToken, "utf8")
    .digest("hex");

  const expected = Buffer.from(knownTokenHash.toLowerCase(), "hex");
  const actual = Buffer.from(actualHash, "hex");

  return crypto.timingSafeEqual(expected, actual)
    ? AriadneMode.ADMINISTRATIVE
    : null;
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
 * 1. ADMINISTRATIVE mode is operator-controlled — never changed here.
 * 2. Explicit companion-mode activation phrases → COMPANION
 * 3. Task-indicator keywords present             → OPERATIONAL
 * 4. No match                                    → retain current mode
 */
export function detectModeSwitch(
  input: string,
  currentMode: AriadneMode,
): AriadneMode {
  // ADMINISTRATIVE mode is set and cleared by the operator layer only.
  if (currentMode === AriadneMode.ADMINISTRATIVE) {
    return currentMode;
  }

  const normalized = input.toLowerCase();

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
