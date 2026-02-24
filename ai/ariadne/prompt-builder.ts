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
 *
 * This prevents drift by keeping the monolithic seed split into auditable,
 * independently maintainable sections.
 */
export function buildAriadnePrompt(mode: AriadneMode): string {
  const core = readSection("core-identity.md");
  const operational = readSection("operational-baseline.md");
  const companion = readSection("companion-mode.md");

  if (mode === AriadneMode.OPERATIONAL) {
    return `${core}\n\n${operational}`;
  }

  // COMPANION: operational baseline is still included — companion is additive
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
