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
 *
 * ADMINISTRATIVE elevation requires an authenticated token; use
 * `switchToAdminMode` for that path.
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
 * Structured entry for audit log storage.
 * The application layer is responsible for persisting these entries.
 */
export interface AuditLogEntry {
  readonly event:
    | "admin_elevation_success"
    | "admin_elevation_failure"
    | "security_violation";
  readonly timestamp: number;
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Minimal audit logger interface — the application layer supplies a concrete
 * implementation (e.g. write to file, emit to SIEM, append to DB).
 */
export interface AuditLogger {
  log(entry: AuditLogEntry): void;
  logSecurityViolation(detail: {
    toolName: string;
    attemptedMode: AriadneMode;
    allowedTools: readonly string[];
    timestamp: number;
  }): void;
}

/**
 * Thrown when a tool is invoked outside its permitted mode.
 */
export class SecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityViolationError";
  }
}

/**
 * Administrative session manager with timed expiration.
 *
 * Wraps `switchToAdminMode` with session lifecycle management.
 * All elevation attempts — successful or not — are recorded via `AuditLogger`.
 *
 * @param auditLogger       Receives all elevation and termination audit events.
 * @param sessionDurationMs Session lifetime in milliseconds (default: 1 hour).
 *                          Override in high-security environments for shorter windows.
 */
export class AdministrativeSession {
  private static readonly DEFAULT_SESSION_DURATION_MS = 3_600_000; // 1 hour
  private sessionExpiry: number | null = null;

  constructor(
    private readonly auditLogger: AuditLogger,
    private readonly sessionDurationMs: number = AdministrativeSession.DEFAULT_SESSION_DURATION_MS,
  ) {}

  /**
   * Validate token and establish a timed administrative session.
   *
   * Returns `{ success: true, expiresAt }` on a valid token, or
   * `{ success: false }` on failure. A failure is always audit-logged.
   */
  public elevateSession(
    authToken: string,
    knownTokenHash: string,
  ): { success: boolean; expiresAt?: number } {
    const mode = switchToAdminMode(authToken, knownTokenHash);

    if (mode === AriadneMode.ADMINISTRATIVE) {
      const expiresAt = Date.now() + this.sessionDurationMs;
      this.sessionExpiry = expiresAt;
      this.auditLogger.log({
        event: "admin_elevation_success",
        timestamp: Date.now(),
        detail: { expiresAt },
      });
      return { success: true, expiresAt };
    }

    this.auditLogger.log({
      event: "admin_elevation_failure",
      timestamp: Date.now(),
      detail: {},
    });
    return { success: false };
  }

  /**
   * Return true if an administrative session is currently active and unexpired.
   */
  public isSessionValid(): boolean {
    return this.sessionExpiry !== null && Date.now() < this.sessionExpiry;
  }

  /**
   * Force session termination (manual logout or emergency stop).
   */
  public terminateSession(): void {
    this.sessionExpiry = null;
  }
}

/**
 * Runtime tool guard that validates every tool execution against the current mode.
 *
 * Prevents cross-mode tool access at the execution layer, not just the UI layer.
 * Any unauthorised attempt is audit-logged before throwing `SecurityViolationError`.
 */
export class ToolGuard {
  constructor(
    private readonly stateMachine: { currentMode: AriadneMode },
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Validate a tool execution request against the current mode's allowed tools.
   *
   * Returns the validated request payload on success.
   * Throws `SecurityViolationError` when the tool is not permitted in the current mode.
   */
  public validateToolExecution(
    toolName: string,
    input: unknown,
  ): { toolName: string; input: unknown; timestamp: number } {
    const currentMode = this.stateMachine.currentMode;
    const allowedTools = MODE_TOOLS[currentMode];

    if (!allowedTools.includes(toolName)) {
      const timestamp = Date.now();
      this.auditLogger.logSecurityViolation({
        toolName,
        attemptedMode: currentMode,
        allowedTools,
        timestamp,
      });
      throw new SecurityViolationError(
        `Tool '${toolName}' not permitted in ${currentMode} mode`,
      );
    }

    return { toolName, input, timestamp: Date.now() };
  }
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
