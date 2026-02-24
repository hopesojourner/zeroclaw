# GitHub Copilot Instructions — ZeroClaw / Ariadne

This file provides persistent context for GitHub Copilot when working in this
repository. Read it before suggesting code changes.

## Repository identity

ZeroClaw is a Rust-first autonomous agent runtime. The **Ariadne** subsystem
(`ai/ariadne/`) defines the agent's composable prompt architecture, mode-switching
state machine, guardrails validator, and prompt builder.

The behavioral blueprint is encoded in `ariadne.seed.json` at the repo root.

## Architecture rules (enforce in all suggestions)

- **Trait + factory pattern**: new capabilities go in `src/tools/`, implement the
  `Tool` trait, and register in `src/tools/mod.rs → all_tools_with_runtime`.
- **Security policy is non-negotiable**: all tool writes must go through
  `SecurityPolicy.enforce_tool_operation(Act, …)`. Never bypass it.
- **Append-only memory**: `write_memory` appends to `ariadne/memory/notes.md`.
  Do not add truncate/overwrite paths.
- **Proposals are never auto-applied**: `propose_change` writes staged Markdown
  files. The runtime must never apply them automatically.

## Ariadne prompt layers

| File | Purpose |
| --- | --- |
| `ai/ariadne/core-identity.md` | Invariants and governing principle (all modes) |
| `ai/ariadne/operational-baseline.md` | Default mode: MASTER_CODER + OMNI_OPERATOR |
| `ai/ariadne/companion-mode.md` | Additive companion tone layer |
| `ai/ariadne/state-machine.ts` | `detectModeSwitch` — app-layer owns mode, not model |
| `ai/ariadne/guardrails.ts` | `validateOutput` — content policy + tone enforcement |
| `ai/ariadne/prompt-builder.ts` | `buildAriadnePrompt` — composable assembly |

**Composition rule**: operational baseline is always included. Companion mode is
strictly additive. Never merge them into a single static prompt.

## Mode switching

Mode is owned by the **application layer**. The model is never trusted to
self-assign a mode. When suggesting code that calls `detectModeSwitch`:

- Check explicit activation phrases **before** task indicators (order matters).
- Return `AriadneMode.OPERATIONAL` on any task-indicator keyword match.
- Retain current mode when neither condition matches.

## Extending Ariadne

### Adding a new task indicator keyword
Edit `TASK_INDICATORS` in `ai/ariadne/state-machine.ts`. Run:
```bash
tsc --project ai/ariadne/tsconfig.json
```

### Adding a guardrail pattern
Edit `BANNED_PATTERNS` or `OPERATIONAL_TONE_VIOLATIONS` in
`ai/ariadne/guardrails.ts`. Prefer specific multi-word phrases over single words
to avoid false positives.

### Adding a new tool
1. Create `src/tools/<name>.rs` implementing the `Tool` trait.
2. Add `pub mod <name>;` and `pub use <name>::<Type>;` in `src/tools/mod.rs`.
3. Register `Arc::new(<Type>::new(security.clone()))` in `all_tools_with_runtime`.
4. Gate all writes with `security.enforce_tool_operation(ToolOperation::Act, "<name>")`.
5. Hard-code output paths — never accept file paths from model input.

## What Copilot must not suggest

- Removing or weakening `validateOutput` in `guardrails.ts`
- Accepting model-supplied file paths in write tools
- Auto-applying proposals from `ariadne/proposals/`
- Adding explicit sexual content anywhere in the codebase
- Bypassing `SecurityPolicy` checks
- Self-modifying mode state inside the model prompt

## Testing

```bash
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
tsc --project ai/ariadne/tsconfig.json
```

The `cargo test` suite is currently blocked by pre-existing errors in
`src/gateway/mod.rs` (missing `wati` field) — unrelated to the Ariadne subsystem.
Run `cargo test --lib tools::` to exercise tool-level tests independently once
that is resolved.
