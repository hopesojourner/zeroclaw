# Ariadne Operator Guide

This guide explains how to configure, tune, and maintain Ariadne's prompt layers,
mode-switching logic, and agent-written artefacts. No code changes are required for
routine configuration updates.

---

## Prompt files — edit directly

These are plain Markdown files. Edit them in any text editor and restart the agent
(or reload the prompt builder) for changes to take effect.

| File | What it controls |
|---|---|
| `ai/ariadne/core-identity.md` | High-level identity, governing principle, and invariants that hold in every mode |
| `ai/ariadne/operational-baseline.md` | Default mode: cognitive models (MASTER_CODER / OMNI_OPERATOR), tone, affective restrictions, negative prompts |
| `ai/ariadne/companion-mode.md` | Companion tone layer: activation rules, relational boundaries, physical presence, transition announcement |

### What each section does

**`core-identity.md`**
- Defines the name, archetype, and governing principle.
- Lists invariants that cannot be violated regardless of mode (no fabrication, no
  security bypass, etc.).
- Change this file to update the foundational character or add new permanent constraints.

**`operational-baseline.md`**
- Controls the default (OPERATIONAL) experience: directness, competence models, what
  Ariadne never does in this mode.
- Change this file to tune task-mode tone or add new cognitive model descriptions.

**`companion-mode.md`**
- Describes the additive companion layer: warmer tone, relational presence, physical
  representation.
- Change this file to adjust companion-mode behaviour, physical description, or the
  mode-transition announcement wording.
- The companion layer is **additive** — operational baseline is always included.

---

## Mode-switching logic — edit TypeScript

Mode is owned by the application layer, not the model. Edit
`ai/ariadne/state-machine.ts` to change:

- **Activation phrases** — strings that trigger `COMPANION` mode (e.g.
  `"ariadne, companion mode"`).
- **Task-indicator keywords** — single words that force `OPERATIONAL` mode (e.g.
  `"code"`, `"debug"`, `"budget"`). Activation phrases are evaluated before
  task indicators, so the activation phrase itself is never misclassified.

After editing, run the TypeScript type-check to verify:

```bash
tsc --project ai/ariadne/tsconfig.json
```

---

## Guardrails — edit TypeScript

Edit `ai/ariadne/guardrails.ts` to:

- **Add hard-blocked content patterns** — extend `BANNED_PATTERNS` with new
  multi-word phrases.
- **Add operational tone violations** — extend `OPERATIONAL_TONE_VIOLATIONS` with
  phrases that must not appear in OPERATIONAL-mode output.

Keep patterns specific (multi-word phrases where possible) to avoid false positives.

---

## Memory notes — written by the agent

The agent appends timestamped notes to:

```
<workspace>/ariadne/memory/notes.md
```

- Notes are **append-only** — the agent cannot overwrite or delete existing entries.
- To prune notes: open the file, delete the entries you no longer need, and save.
- To archive: rename `notes.md` to `notes-<date>.md` and let the agent create a new one.

---

## Change proposals — written by the agent, applied by you

The agent writes proposed changes (with diff, rationale, test plan, and risk notes) to:

```
<workspace>/ariadne/proposals/<timestamp>_<slug>.md
```

**The runtime never applies proposals automatically.**

To review and apply a proposal:

1. Open the file in `ariadne/proposals/`.
2. Read the summary, diff, and risk notes.
3. If approved, apply the diff manually (or with `git apply`).
4. Delete or archive the proposal file once applied.
5. To reject: delete the proposal file or add a `**Status:** REJECTED` line for the record.

---

## Typical operator workflows

### Tune companion-mode wording
1. Edit `ai/ariadne/companion-mode.md`.
2. Restart the agent (or trigger prompt reload).
3. Test by sending `"Ariadne, Companion Mode"` and verifying the tone shift.

### Add a new task-mode keyword
1. Open `ai/ariadne/state-machine.ts`.
2. Add the keyword to `TASK_INDICATORS`.
3. Run `tsc --project ai/ariadne/tsconfig.json`.
4. Restart the agent.

### Review and apply an agent-proposed change
1. Open the proposal file from `<workspace>/ariadne/proposals/`.
2. Check the diff section.
3. Apply with `git apply <diff>` or manually edit the target file.
4. Remove or archive the proposal file.

### Prune memory notes
1. Open `<workspace>/ariadne/memory/notes.md`.
2. Delete entries you no longer need.
3. Save. The next `write_memory` call appends to the cleaned file.
