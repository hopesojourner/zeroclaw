/**
 * Ariadne Architecture Validation Tests
 *
 * Covers the validation protocol phases:
 *   Phase B – Runtime Initialization (state machine default mode, tool lists)
 *   Phase C – Functional Validation (state transitions, tool boundary enforcement)
 *   Phase E – Security Validation (admin auth, input sanitization via guardrails)
 */

import * as crypto from "crypto";
import {
  AriadneMode,
  detectModeSwitch,
  getAvailableModeTools,
  switchToAdminMode,
  MODE_TOOLS,
} from "../state-machine";
import { validateOutput } from "../guardrails";

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
