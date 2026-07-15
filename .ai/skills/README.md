# Carbon skills — index

Source of truth for agent skills. Installed as symlinks into `.claude/skills/`
and `.codex/skills/` by `.ai/scripts/install-skills.sh` (runs on `pnpm prepare`;
manually: `pnpm install-skills`). Authoring rules: `writing-skills/SKILL.md`.

## Pipelines

**Feature** (phased, human gates at spec + plan):

```
/research → /spec-writing → /plan → /execute → /test → /self-review
                 🛑 open questions      🛑 plan approval
```

`/feature` runs this pipeline. At start it picks an **autonomy mode**
(approval-before-each-phase vs fully autonomous — autonomous auto-resolves the
🛑 gates and records the decision) and a **phase set** (`/plan` + `/execute` are
mandatory; research, spec, test, self-review are optional, auto-detected from
the request), and keeps a run record at `.ai/runs/{date}-{slug}.md`.
`/spec-writing` resolves its Open Questions via `/grill`. `/execute` commits per
task via `/check-and-commit`.

**Bug fix**:

```
/root-cause → (/debugging-difficult-bugs if runtime evidence needed) → fix (implements) → /test → /check-and-commit
```

`/fix` runs this pipeline end-to-end: it orchestrates the diagnosis and
verification phases **and** implements the fix itself (the minimal change plus a
red→green regression test). At start it picks an **autonomy mode**
(approval-before-each-phase vs fully autonomous — autonomous auto-resolves the
conditional branches and records each choice) and a **phase set** (root-cause +
fix are mandatory; runtime instrumentation is conditional on confidence, test is
optional, commit runs only on explicit ask), and keeps a run record at
`.ai/runs/{date}-{slug}.md`. The two 🛑 hard stops (architectural three-strikes
in root-cause, BLOCKED in fix) always surface to the human.

**Autonomous loop** (single scoped item, doer→gate→judge, no mid-loop human input, gated PR): `/conductor`.

**Advisory audit** (read-only, produces handoff plans): `/improve`.

## Skills

| Skill | Purpose | Produces |
|-------|---------|----------|
| `research` | Competitor/industry survey for a feature | `.ai/research/{slug}.md` |
| `spec-writing` | Design + spec with Open Questions hard stop | `.ai/specs/{date}-{slug}.md` |
| `grill` | Interview stress-test of a plan/spec/design, one question at a time | resolutions in the spec/plan, or `.ai/runs/{date}-grill-{slug}.md` |
| `plan` | Implementation plan from a finalized spec | `.ai/plans/{date}-{slug}.md` |
| `execute` | Run an approved plan task by task | commits on the branch |
| `feature` | The full pipeline above, orchestrated | all of the above |
| `root-cause` | Read-only bug analysis → brief | root-cause brief (chat) |
| `debugging-difficult-bugs` | Temporary JSONL runtime instrumentation | log-backed root cause |
| `fix` | End-to-end bug-fix pipeline; diagnoses via /root-cause, implements the minimal fix + red→green regression test, verifies, commits on explicit ask | ready-to-commit change (+ run record) |
| `check-and-commit` | Gate suite, then commit specific files | conventional commit |
| `self-review` | Review your own branch before/at PR time | Must fix / Risks / Suggestions |
| `conductor` | Autonomous doer→gate→judge loop to a gated PR (no mid-loop human input) | PR + ledger |
| `improve` | Senior-advisor audit; plans for other agents to execute | `.ai/plans/improve/` |
| `test` | Drive changed flows in the browser; cache playbooks | pass/fail + `.ai/playbooks/{slug}.md` |
| `smoke-test` | Do all core modules load? | pass/fail table |
| `auth` | Authenticate agent-browser against local dev | authed session (building block) |
| `error` | Capture screenshot + snapshot on browser failure | `.ai/scratch/e2e/…` (building block) |
| `create-agents-md` | Generate/refresh a grounded AGENTS.md | `AGENTS.md` |
| `inngest` | Inngest v3 platform reference (steps, events, flow control, errors) as Carbon runs it | knowledge (no artifact) |
| `rust` | Rust reference for the cargo workspace (tokio+FFI discipline, state choices, perf) | knowledge (no artifact) |
| `carbon-docs` | Author reader-facing docs in the docs app | `docs/content/**` |
| `translate` | Fill missing i18n .po translations via cheap Haiku subagents | `packages/locale/locales/*/*.po` |
| `test-driven-development` | Red→green→refactor discipline (vitest) | tests-first code |
| `writing-skills` | House guide for authoring skills | skills |
| `pr-explainer` | Self-contained HTML review aid for a PR | `.pr-review/*.html` |
| `pr-splitter` | Split a large PR into reviewable stacked PRs | branches + split notes |
| `ui` | Remote-managed UI exploration shim (uidotsh) | — |
| `agent-browser` | External: browser CLI reference (pinned in `skills-lock.json`) | — |
| `make-interfaces-feel-better` | External: UI polish principles (pinned in `skills-lock.json`) | — |

## Conventions every skill follows

- Workflow skills announce themselves at start ("Using the {name} skill — …")
  so the human always knows which playbook is running.
- Typecheck is always scoped: `pnpm exec turbo run typecheck --filter=<pkg>`.
  Whole-repo typecheck OOMs — no skill may prescribe it.
- `pnpm run generate:types` after any migration, before typechecking.
- Commits only through `/check-and-commit` (explicit file staging, conventional
  messages); push only when the branch tracks a remote or the user asked.
- Ephemeral output (screenshots, debug logs) goes to gitignored `.ai/scratch/`,
  never into tracked trees.
- `agent-browser` + `make-interfaces-feel-better` are external skills pinned in
  `skills-lock.json` — update them via their upstream, don't edit in place.
