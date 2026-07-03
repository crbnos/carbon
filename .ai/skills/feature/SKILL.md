---
name: feature
description: End-to-end feature pipeline that runs /research, /spec-writing, /plan, /execute, /test, and /self-review in order with human gates between phases. Use when building a new feature from scratch ("build a feature", "implement X from scratch"). Do not use for bug fixes (use /root-cause then /fix) or when an artifact already exists — enter the pipeline at the first missing phase instead.
---

# feature — end-to-end pipeline

Runs the full feature lifecycle by invoking the phase skills in order. This
skill adds no logic of its own — each phase's rules live in its own skill.

**Announce at start:** "Using the feature skill — running the full pipeline for
{feature}."

## The pipeline

| # | Phase | Skill | Artifact | Gate before next phase |
|---|-------|-------|----------|-------------------------|
| 1 | Research | `/research` | `.ai/research/{slug}.md` | none |
| 2 | Design + spec | `/spec-writing` | `.ai/specs/{date}-{slug}.md` | 🛑 every Open Question resolved by the user |
| 3 | Plan | `/plan` | `.ai/plans/{date}-{slug}.md` | 🛑 user approves the plan |
| 4 | Build | `/execute` | commits on the feature branch | all tasks verified + committed |
| 5 | Browser verify | `/test` | pass/fail table + playbooks | every user-facing flow passes |
| 6 | Review | `/self-review` | Must fix / Risks / Suggestions | Must-fix items resolved |

Run the phases strictly in order. Announce each phase transition in one line
("Phase 3: planning — spec approved, writing the plan").

## Entering mid-pipeline

Start at the first phase whose artifact is missing or stale:

| You already have | Start at |
|------------------|----------|
| Nothing | Phase 1 |
| Research file | Phase 2 |
| Finalized spec (open questions resolved) | Phase 3 |
| Approved plan | Phase 4 |
| Built code, unverified | Phase 5 |

## Hard rules

- Never skip a 🛑 gate. The gates exist to force human judgment at the two
  points where rework is most expensive (design and plan).
- Never let a phase write its artifact somewhere non-canonical — the paths in
  the table are the only correct ones.
- If a later phase reveals the spec was wrong, stop, update the spec (and its
  changelog), re-gate, then resume.

## Alternative: the conductor

For a single tightly-scoped item (a bug, a usability tweak, a small feature)
with explicit acceptance criteria, prefer `/conductor` — it runs a
doer→gate→judge loop with the human watching instead of this phased pipeline.
