---
name: feature
description: End-to-end feature pipeline that orchestrates /research, /spec-writing, /plan, /execute, /test, and /self-review. At start it picks an autonomy mode (approval-before-each-phase vs fully autonomous) and a phase set (plan + execute are mandatory; research, spec, test, self-review are optional), auto-detected from the request and confirmed with the user when unclear. Keeps a structured run record at .ai/runs/{date}-{slug}.md. Use when building a new feature ("build a feature", "implement X"). Do not use for bug fixes (use /root-cause then /fix). Enter mid-pipeline when an artifact already exists.
---

# feature — end-to-end pipeline

Runs the feature lifecycle by invoking the phase skills. Each phase's rules live
in its own skill; this skill only orchestrates — it chooses the autonomy mode,
selects which phases to run, drives them in order, and keeps the run record.

**Announce at start:** "Using the feature skill — {autonomy mode}, phases:
{selected}."

## The phases

| # | Phase | Skill | Artifact | Mandatory? | Gate before next phase |
|---|-------|-------|----------|-----------|-------------------------|
| 1 | Research | `/research` | `.ai/research/{slug}.md` | optional | none |
| 2 | Design + spec | `/spec-writing` | `.ai/specs/{date}-{slug}.md` | optional | 🛑 every Open Question resolved |
| 3 | Plan | `/plan` | `.ai/plans/{date}-{slug}.md` | **always** | 🛑 plan approved |
| 4 | Build | `/execute` | commits on the feature branch | **always** | all tasks verified + committed |
| 5 | Browser verify | `/test` | pass/fail table + playbooks | optional | every user-facing flow passes |
| 6 | Review | `/self-review` | Must fix / Risks / Suggestions | optional | Must-fix items resolved |

`/plan` and `/execute` are non-negotiable — you cannot build without a plan, and
execute is the point. Everything else is opt-in per feature.

## Step 0: Choose autonomy mode + phase set — always first

Write the run record (below) as you make these choices, then announce them.

### 0a. Autonomy mode

Detect from the request; ask only if neither is clear.

| Mode | Signals | Behavior |
|------|---------|----------|
| **Approval-per-phase** | "ask me", "step by step", "check with me", "gate each phase" | Pause before each phase, state what it will do in one line, wait for go. The two 🛑 gates stay human. |
| **Fully autonomous** | "autonomously", "just build it", "don't ask", "end to end" | Run unattended. At the two 🛑 gates, make a reasonable decision, **record it + rationale in the run record**, and proceed. No mid-run pauses. |

Default when ambiguous: **ask** — one question, the two options above.

### 0b. Phase set

Auto-detect the recommended set, then: in approval mode, present it and let the
user adjust; in autonomous mode, record the choices and proceed.

Detection heuristics (recommend, don't dogmatically enforce):

- **Research** — include when requirements are vague/open-ended. **Force-include
  for ERP-domain logic** (accounting, costing, tax, inventory valuation, RMA,
  MRP, scheduling): never invent domain logic. Skip when the user gave clear,
  detailed requirements for a non-domain feature.
- **Spec** — include when the change touches 3+ files, crosses modules, or adds
  a data model (spec-writing's own trigger). Skip for a well-understood
  single-surface feature with clear requirements — go straight to plan.
- **Plan / Execute** — always on a fresh run (a resumed run may start at Execute
  when an approved plan already exists — see Entering mid-pipeline).
- **Test** — include for user-facing flows. Skip when the user says it's
  straightforward, wants to verify manually, or flags browser-test cost — but
  say so in the record ("test skipped — user opts to verify manually").
- **Self-review** — include by default (cheap, catches Must-fix before PR). Skip
  only on request.

If requirements are unclear and research is a candidate, in approval mode ask:
"Do you have firm requirements, or should I research and draft them?"

## Step 0c: Open the run record — the standardization artifact

Create `.ai/runs/{date}-{slug}.md` before the **first selected phase** (phase 1
on a fresh run; a later phase on a resumed run — see Entering mid-pipeline).
This is what makes ten engineers on the same feature produce comparable
results — one canonical log of what was decided and why.

```markdown
# Feature run: {title}

- Date: {date}            <!-- ask the user or use the injected currentDate; skills have no clock -->
- Mode: approval-per-phase | fully-autonomous
- Request: {the user's ask, verbatim}
- Phase plan: research [run|skip — why] · spec [run|skip — why] · plan [run] · execute [run] · test [run|skip — why] · self-review [run|skip — why]

## Decisions            <!-- autonomous auto-resolutions at 🛑 gates; empty in approval mode -->
- {gate}: {decision} — {rationale} — {timestamp}

## Phase log
- {phase}: {outcome + artifact path}

## Outcome
- {PR link / final status}
```

Update it at each phase transition and whenever an autonomous gate is
auto-resolved. Runtime lives in `.ai/runs/` (gitignored) — never in the product tree.

## Running the phases

Run the **selected** phases strictly in order; skip the deselected ones.
Announce each transition in one line ("Phase 3: planning — spec approved").
A gate applies only if its phase runs (skip spec → no Open-Questions gate).

- **Approval mode:** before each phase, pause for the user's go. Honor both 🛑
  gates as human stops.
- **Autonomous mode:** at each 🛑 gate, decide, append the decision to the run
  record's Decisions section, and continue — no pause.

## Entering mid-pipeline

Start at the first selected phase whose artifact is missing or stale:

| You already have | Start at |
|------------------|----------|
| Nothing | first selected phase |
| Research file | Spec (or Plan if spec deselected) |
| Finalized spec | Plan |
| Approved plan | Execute |
| Built code, unverified | Test (or Self-review) |

## Hard rules

- On a fresh run, `/plan` and `/execute` always run — never skip them. A resumed
  run may start past plan only when an approved plan already exists (see Entering
  mid-pipeline).
- In approval mode, never skip a 🛑 gate. In autonomous mode, never skip
  *recording* an auto-resolved gate decision — the record is the audit trail.
- Never let a phase write its artifact somewhere non-canonical — the paths in
  the phases table are the only correct ones.
- If a later phase reveals the spec/plan was wrong, stop, update the artifact
  (and its changelog), re-gate (or re-record in autonomous mode), then resume.
- Skipping a phase is a logged decision, not a silent omission — it goes in the
  run record with a reason.

## Alternative: the conductor

For a single tightly-scoped item (a bug, a usability tweak, a small feature)
with explicit acceptance criteria, prefer `/conductor` — a supervised
doer→gate→judge loop instead of this phased pipeline.
