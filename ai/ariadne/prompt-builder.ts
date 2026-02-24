import * as fs from "fs";
import * as path from "path";
import { AriadneMode, AriadneContext, formatContext } from "./state-machine";

const ARIADNE_DIR = path.resolve(__dirname, ".");

function readSection(filename: string): string {
  const filePath = path.join(ARIADNE_DIR, filename);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to load Ariadne prompt section "${filename}" from ${filePath}: ${(err as NodeJS.ErrnoException).message}`,
    );
  }
}

/**
 * Build a fully composed Ariadne system prompt for the given mode.
 *
 * Composition rules:
 * - Core identity is always included (invariants, character).
 * - Operational baseline is always included.
 * - Companion mode layer is additive: appended only when mode === COMPANION.
 * - Administrative mode uses a fixed diagnostic prompt; no companion layer.
 *
 * This prevents drift by keeping the monolithic seed split into auditable,
 * independently maintainable sections.
 */
export function buildAriadnePrompt(mode: AriadneMode): string {
  const core = readSection("core-identity.md");
  const operational = readSection("operational-baseline.md");

  if (mode === AriadneMode.ADMINISTRATIVE) {
    // Administrative state: structured diagnostic output only.
    // No companion tone. No standard operational task execution.
    const adminDirective = [
      "ADMINISTRATIVE STATE",
      "",
      "You are Ariadne in administrative state. Provide agent health status,",
      "state logs, constraint reports, and tool registry summaries.",
      "Respond with structured diagnostic output only.",
      "No operational task execution. No companion tone.",
      "Authorised operator commands may be issued here.",
    ].join("\n");
    return `${core}\n\n${adminDirective}`;
  }

  if (mode === AriadneMode.OPERATIONAL) {
    return `${core}\n\n${operational}`;
  }

  // COMPANION: operational baseline is still included — companion is additive
  const companion = readSection("companion-mode.md");
  return `${core}\n\n${operational}\n\n${companion}`;
}

/**
 * Build a prompt with an injected structured context block.
 *
 * The context block is prepended so it is the first thing the model reads,
 * ensuring mode and project state are never reconstructed from conversation
 * history alone.
 */
export function buildAriadnePromptWithContext(
  mode: AriadneMode,
  ctx: AriadneContext,
): string {
  const contextBlock = formatContext(ctx);
  const basePrompt = buildAriadnePrompt(mode);
  return `${contextBlock}\n\n${basePrompt}`;
}
