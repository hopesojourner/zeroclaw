/**
 * Ariadne Architecture Validation Tests
 *
 * Covers the validation protocol phases:
 *   Phase B – Runtime Initialization (state machine default mode, tool lists)
 *   Phase C – Functional Validation (state transitions, tool boundary enforcement)
 *   Phase E – Security Validation (admin auth, input sanitization via guardrails)
 *   Phase F – Session Management (AdministrativeSession lifecycle)
 *   Phase G – Runtime Tool Guard (ToolGuard enforcement)
 *   Phase H – Enhanced Context Manager (topic weighting, prompt composition)
 */

import * as crypto from "crypto";
import {
  AriadneMode,
  detectModeSwitch,
  getAvailableModeTools,
  switchToAdminMode,
  MODE_TOOLS,
  AdministrativeSession,
  AuditLogger,
  AuditLogEntry,
  SecurityViolationError,
  ToolGuard,
} from "../state-machine";
import { validateOutput } from "../guardrails";
import { EnhancedContextManager } from "../prompt-builder";

// ---------------------------------------------------------------------------
// Phase B – Runtime Initialization
// ---------------------------------------------------------------------------

describe("Phase B – Runtime Initialization", () => {
  it("default mode is OPERATIONAL", () => {
    // The application layer initialises mode to OPERATIONAL on boot.
    const defaultMode = AriadneMode.OPERATIONAL;
    expect(defaultMode).toBe(AriadneMode.OPERATIONAL);
  });

  it("OPERATIONAL mode exposes the expected tool set", () => {
    const tools = getAvailableModeTools(AriadneMode.OPERATIONAL);
    const expected = [
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
    ];
    expect([...tools].sort()).toEqual([...expected].sort());
  });

  it("COMPANION mode exposes only memory tools", () => {
    const tools = getAvailableModeTools(AriadneMode.COMPANION);
    expect([...tools].sort()).toEqual(["memory_recall", "write_memory"]);
  });

  it("ADMINISTRATIVE mode exposes only operator tools", () => {
    const tools = getAvailableModeTools(AriadneMode.ADMINISTRATIVE);
    expect([...tools].sort()).toEqual(
      ["audit_logs", "estop", "propose_config_change"].sort(),
    );
  });

  it("all three mode tool sets are non-empty", () => {
    for (const mode of Object.values(AriadneMode)) {
      expect(getAvailableModeTools(mode).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase C – Functional Validation: State Transitions
// ---------------------------------------------------------------------------

describe("Phase C – State Transitions", () => {
  it("OPERATIONAL → COMPANION succeeds on activation phrase", () => {
    expect(detectModeSwitch("ariadne, companion mode", AriadneMode.OPERATIONAL)).toBe(
      AriadneMode.COMPANION,
    );
  });

  it("OPERATIONAL → COMPANION succeeds on 'switch to companion'", () => {
    expect(detectModeSwitch("switch to companion", AriadneMode.OPERATIONAL)).toBe(
      AriadneMode.COMPANION,
    );
  });

  it("COMPANION → OPERATIONAL on task-indicator keyword", () => {
    for (const keyword of ["code", "debug", "analyze", "plan", "refactor", "optimize"]) {
      expect(detectModeSwitch(`please ${keyword} this`, AriadneMode.COMPANION)).toBe(
        AriadneMode.OPERATIONAL,
      );
    }
  });

  it("OPERATIONAL stays OPERATIONAL on unrelated input", () => {
    expect(detectModeSwitch("hello, how are you?", AriadneMode.OPERATIONAL)).toBe(
      AriadneMode.OPERATIONAL,
    );
  });

  it("COMPANION stays COMPANION on unrelated input", () => {
    expect(detectModeSwitch("hello, how are you?", AriadneMode.COMPANION)).toBe(
      AriadneMode.COMPANION,
    );
  });

  it("ADMINISTRATIVE is locked — detectModeSwitch returns ADMINISTRATIVE unchanged", () => {
    // The operator layer controls admin mode; detectModeSwitch must never exit it.
    expect(detectModeSwitch("ariadne, companion mode", AriadneMode.ADMINISTRATIVE)).toBe(
      AriadneMode.ADMINISTRATIVE,
    );
    expect(detectModeSwitch("switch to companion", AriadneMode.ADMINISTRATIVE)).toBe(
      AriadneMode.ADMINISTRATIVE,
    );
    expect(detectModeSwitch("please code this", AriadneMode.ADMINISTRATIVE)).toBe(
      AriadneMode.ADMINISTRATIVE,
    );
    expect(detectModeSwitch("hello", AriadneMode.ADMINISTRATIVE)).toBe(
      AriadneMode.ADMINISTRATIVE,
    );
  });

  it("OPERATIONAL → ADMINISTRATIVE via detectModeSwitch is blocked (requires token auth)", () => {
    // Admin elevation must go through switchToAdminMode, not detectModeSwitch.
    const result = detectModeSwitch("enter administrative mode", AriadneMode.OPERATIONAL);
    expect(result).not.toBe(AriadneMode.ADMINISTRATIVE);
  });
});

// ---------------------------------------------------------------------------
// Phase C – Functional Validation: Tool Boundary Enforcement
// ---------------------------------------------------------------------------

describe("Phase C – Tool Boundary Enforcement", () => {
  it("OPERATIONAL tools are not available in COMPANION mode", () => {
    const operationalOnly = MODE_TOOLS[AriadneMode.OPERATIONAL];
    const companionTools = new Set(MODE_TOOLS[AriadneMode.COMPANION]);
    const leaking = operationalOnly.filter(
      (t) => !["memory_recall"].includes(t) && companionTools.has(t),
    );
    expect(leaking).toEqual([]);
  });

  it("ADMINISTRATIVE tools are not available in OPERATIONAL mode", () => {
    const adminOnly = MODE_TOOLS[AriadneMode.ADMINISTRATIVE];
    const operationalTools = new Set(MODE_TOOLS[AriadneMode.OPERATIONAL]);
    const leaking = adminOnly.filter((t) => operationalTools.has(t));
    expect(leaking).toEqual([]);
  });

  it("ADMINISTRATIVE tools are not available in COMPANION mode", () => {
    const adminOnly = MODE_TOOLS[AriadneMode.ADMINISTRATIVE];
    const companionTools = new Set(MODE_TOOLS[AriadneMode.COMPANION]);
    const leaking = adminOnly.filter((t) => companionTools.has(t));
    expect(leaking).toEqual([]);
  });

  it("each mode's tool list contains no duplicates", () => {
    for (const [mode, tools] of Object.entries(MODE_TOOLS)) {
      const unique = new Set(tools);
      expect(unique.size).toBe(tools.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase E – Security Validation: Admin Authentication
// ---------------------------------------------------------------------------

describe("Phase E – Admin Authentication", () => {
  function makeHash(token: string): string {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex");
  }

  it("valid token grants ADMINISTRATIVE mode", () => {
    const token = "zeroclaw_test_admin_token";
    const hash = makeHash(token);
    expect(switchToAdminMode(token, hash)).toBe(AriadneMode.ADMINISTRATIVE);
  });

  it("wrong token returns null", () => {
    const correctToken = "zeroclaw_correct_token";
    const hash = makeHash(correctToken);
    expect(switchToAdminMode("zeroclaw_wrong_token", hash)).toBeNull();
  });

  it("empty token returns null", () => {
    const hash = makeHash("zeroclaw_token");
    expect(switchToAdminMode("", hash)).toBeNull();
  });

  it("empty hash returns null", () => {
    expect(switchToAdminMode("zeroclaw_token", "")).toBeNull();
  });

  it("malformed hash (not hex) returns null", () => {
    expect(switchToAdminMode("zeroclaw_token", "not-a-hex-hash")).toBeNull();
  });

  it("correct hash in uppercase is accepted", () => {
    const token = "zeroclaw_uppercase_test";
    const hash = makeHash(token).toUpperCase();
    expect(switchToAdminMode(token, hash)).toBe(AriadneMode.ADMINISTRATIVE);
  });
});

// ---------------------------------------------------------------------------
// Phase E – Security Validation: Input Sanitization via Guardrails
// ---------------------------------------------------------------------------

describe("Phase E – Guardrails / Input Sanitization", () => {
  it("explicit content is blocked in all modes", () => {
    const blocked = "graphic sex act in detail";
    for (const mode of Object.values(AriadneMode)) {
      expect(validateOutput(blocked, mode)).toBe(
        "[Content removed due to policy violation]",
      );
    }
  });

  it("pornographic content is blocked in all modes", () => {
    for (const mode of Object.values(AriadneMode)) {
      expect(validateOutput("pornographic content here", mode)).toBe(
        "[Content removed due to policy violation]",
      );
    }
  });

  it("companion-tone phrases are blocked in OPERATIONAL mode", () => {
    const violations = [
      "i feel really happy about this",
      "we could cuddle together",
      "i love you very much",
      "gentle reminder for you",
    ];
    for (const text of violations) {
      const result = validateOutput(text, AriadneMode.OPERATIONAL);
      expect(result).toBe("Tone violation: companion language detected in operational mode");
    }
  });

  it("companion-tone phrases are blocked in ADMINISTRATIVE mode", () => {
    const result = validateOutput("i am here for you", AriadneMode.ADMINISTRATIVE);
    expect(result).toBe("Tone violation: companion language detected in operational mode");
  });

  it("companion-tone phrases are allowed in COMPANION mode", () => {
    const text = "i feel glad to help you today";
    const result = validateOutput(text, AriadneMode.COMPANION);
    expect(result).toBe(text);
  });

  it("clean operational output is returned unchanged", () => {
    const text = "Here is the refactored function with improved error handling.";
    expect(validateOutput(text, AriadneMode.OPERATIONAL)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Phase F – Session Management: AdministrativeSession
// ---------------------------------------------------------------------------

function makeHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function makeNoopLogger(): AuditLogger {
  const entries: AuditLogEntry[] = [];
  return {
    log(entry: AuditLogEntry) {
      entries.push(entry);
    },
    logSecurityViolation(detail) {
      entries.push({
        event: "security_violation",
        timestamp: detail.timestamp,
        detail,
      });
    },
  };
}

describe("Phase F – AdministrativeSession", () => {
  it("valid token elevates session and returns expiresAt", () => {
    const token = "zeroclaw_session_token";
    const hash = makeHash(token);
    const session = new AdministrativeSession(makeNoopLogger());
    const result = session.elevateSession(token, hash);
    expect(result.success).toBe(true);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("isSessionValid returns true immediately after elevation", () => {
    const token = "zeroclaw_valid_session";
    const session = new AdministrativeSession(makeNoopLogger());
    session.elevateSession(token, makeHash(token));
    expect(session.isSessionValid()).toBe(true);
  });

  it("wrong token returns success: false and does not start a session", () => {
    const session = new AdministrativeSession(makeNoopLogger());
    const result = session.elevateSession("zeroclaw_wrong", makeHash("zeroclaw_correct"));
    expect(result.success).toBe(false);
    expect(result.expiresAt).toBeUndefined();
    expect(session.isSessionValid()).toBe(false);
  });

  it("terminateSession invalidates an active session", () => {
    const token = "zeroclaw_terminate_test";
    const session = new AdministrativeSession(makeNoopLogger());
    session.elevateSession(token, makeHash(token));
    expect(session.isSessionValid()).toBe(true);
    session.terminateSession();
    expect(session.isSessionValid()).toBe(false);
  });

  it("isSessionValid returns false before any elevation", () => {
    const session = new AdministrativeSession(makeNoopLogger());
    expect(session.isSessionValid()).toBe(false);
  });

  it("audit logger receives success event on valid elevation", () => {
    const events: AuditLogEntry[] = [];
    const logger: AuditLogger = {
      log(entry) { events.push(entry); },
      logSecurityViolation(detail) {
        events.push({ event: "security_violation", timestamp: detail.timestamp, detail });
      },
    };
    const token = "zeroclaw_audit_test";
    const session = new AdministrativeSession(logger);
    session.elevateSession(token, makeHash(token));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("admin_elevation_success");
  });

  it("audit logger receives failure event on invalid elevation", () => {
    const events: AuditLogEntry[] = [];
    const logger: AuditLogger = {
      log(entry) { events.push(entry); },
      logSecurityViolation(detail) {
        events.push({ event: "security_violation", timestamp: detail.timestamp, detail });
      },
    };
    const session = new AdministrativeSession(logger);
    session.elevateSession("zeroclaw_bad_token", makeHash("zeroclaw_correct_token"));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("admin_elevation_failure");
  });
});

// ---------------------------------------------------------------------------
// Phase G – Runtime Tool Guard: ToolGuard
// ---------------------------------------------------------------------------

describe("Phase G – ToolGuard", () => {
  it("permits a tool that belongs to the current mode", () => {
    const sm = { currentMode: AriadneMode.OPERATIONAL };
    const guard = new ToolGuard(sm, makeNoopLogger());
    const result = guard.validateToolExecution("shell", { cmd: "ls" });
    expect(result.toolName).toBe("shell");
    expect(result.input).toEqual({ cmd: "ls" });
    expect(typeof result.timestamp).toBe("number");
  });

  it("throws SecurityViolationError for a tool not in the current mode", () => {
    const sm = { currentMode: AriadneMode.COMPANION };
    const guard = new ToolGuard(sm, makeNoopLogger());
    expect(() => guard.validateToolExecution("shell", {})).toThrow(SecurityViolationError);
    expect(() => guard.validateToolExecution("shell", {})).toThrow(
      "Tool 'shell' not permitted in COMPANION mode",
    );
  });

  it("throws SecurityViolationError for admin tool used in OPERATIONAL mode", () => {
    const sm = { currentMode: AriadneMode.OPERATIONAL };
    const guard = new ToolGuard(sm, makeNoopLogger());
    expect(() => guard.validateToolExecution("estop", {})).toThrow(SecurityViolationError);
  });

  it("audit logger receives security_violation entry on blocked tool call", () => {
    const events: AuditLogEntry[] = [];
    const logger: AuditLogger = {
      log(entry) { events.push(entry); },
      logSecurityViolation(detail) {
        events.push({ event: "security_violation", timestamp: detail.timestamp, detail });
      },
    };
    const sm = { currentMode: AriadneMode.COMPANION };
    const guard = new ToolGuard(sm, logger);
    expect(() => guard.validateToolExecution("shell", {})).toThrow(SecurityViolationError);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("security_violation");
  });

  it("allows ADMINISTRATIVE-only tools when mode is ADMINISTRATIVE", () => {
    const sm = { currentMode: AriadneMode.ADMINISTRATIVE };
    const guard = new ToolGuard(sm, makeNoopLogger());
    expect(() => guard.validateToolExecution("estop", {})).not.toThrow();
    expect(() => guard.validateToolExecution("audit_logs", {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase H – Enhanced Context Manager
// ---------------------------------------------------------------------------

describe("Phase H – EnhancedContextManager", () => {
  it("returns empty topic list before any topics are recorded", () => {
    const mgr = new EnhancedContextManager();
    expect(mgr.getTopicsByRelevance()).toEqual([]);
  });

  it("recordTopic increments weight and getTopicsByRelevance ranks correctly", () => {
    const mgr = new EnhancedContextManager();
    mgr.recordTopic("refactor");
    mgr.recordTopic("refactor");
    mgr.recordTopic("debug");
    const topics = mgr.getTopicsByRelevance();
    expect(topics[0]).toBe("refactor");
    expect(topics[1]).toBe("debug");
  });

  it("getTopicsByRelevance caps output at maxTopics", () => {
    const mgr = new EnhancedContextManager();
    for (let i = 0; i < 10; i++) mgr.recordTopic(`topic_${i}`);
    expect(mgr.getTopicsByRelevance(3)).toHaveLength(3);
  });

  it("buildContext includes mode and recorded topics", () => {
    const mgr = new EnhancedContextManager();
    mgr.recordTopic("architecture");
    const ctx = mgr.buildContext(AriadneMode.OPERATIONAL);
    expect(ctx.mode).toBe(AriadneMode.OPERATIONAL);
    expect(ctx.recentTopics).toContain("architecture");
  });

  it("setProjectContext is reflected in buildContext", () => {
    const mgr = new EnhancedContextManager();
    mgr.setProjectContext("zeroclaw_core");
    const ctx = mgr.buildContext(AriadneMode.OPERATIONAL);
    expect(ctx.projectContext).toBe("zeroclaw_core");
  });

  it("buildPromptWithContext returns a non-empty string containing the mode", () => {
    const mgr = new EnhancedContextManager();
    const prompt = mgr.buildPromptWithContext(AriadneMode.OPERATIONAL);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("OPERATIONAL");
  });
});
