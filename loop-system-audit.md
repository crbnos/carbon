# Loop System Audit — 2026-07-01

Comprehensive review of Carbon's loop system docs and code after recent refactors (primarily #992 and #957).

---

## 1. What Docs Exist (and Where)

### Old/Deleted Paths (no longer valid)

| Path | Status | Reason |
|------|--------|--------|
| `llm/outer-loop/01-openclaw-plan.md` | **DELETED** | commit `b4c6cdd4c` — design docs dropped from tree |
| `llm/outer-loop/02-repo-changes.md` | **DELETED** | same commit |
| `llm/outer-loop/agent-prompt.md` | **DELETED** | same commit; prompt moved to OpenClaw workspace |
| `llm/outer-loop/README.md` | **DELETED** | commit `09bdfe354` — content moved to `.ai/docs/outer-loop.md` |
| `llm/loops/README.md` | **MOVED** | commit `09bdfe354` → `.ai/docs/loop-system.md` |
| `.claude/skills/conductor/SKILL.md` | **MOVED** | commit `09bdfe354` — now at `.ai/skills/conductor/SKILL.md` |

**Critical:** The entire `llm/` directory is now gitignored wholesale. `.gitignore` says:
```
# Legacy llm/ — consolidated into .ai/ (docs, specs, runs)
llm/
```

`llm/outer-loop/` and `llm/loops/` are **runtime-state directories on disk** (agent-state.db, daily-notes/, runs/, dispatch.db, state.db) — they're not doc directories anymore.

### Current Doc/Skill Locations

| What | Location | Status |
|------|----------|--------|
| Outer-loop architecture | `.ai/docs/outer-loop.md` | ✅ Current (condensed from old 01+02 docs) |
| Loop system / binding format | `.ai/docs/loop-system.md` | ✅ Current (moved from `llm/loops/README.md`) |
| Conductor inner-loop skill | `.ai/skills/conductor/SKILL.md` | ✅ Current (expanded with §2b freshness audit) |
| Institutional memory | `.ai/lessons.md` | ✅ Current (trimmed to 3 core lessons in cf77e3d4d) |
| Skill tier catalog | `.ai/skills/tiers.json` | ✅ Current |
| Agent operating prompt | `/home/openclaw/.openclaw/workspace/agent-prompt.md` | ⚠️ Stale header (see §3) |
| Agent operating manual | `/home/openclaw/.openclaw/workspace/CARBON_AGENT.md` | ⚠️ Multiple stale refs (see §3) |

---

## 2. What the Code Actually Looks Like Now

### @carbon/harness

**Public exports** (`packages/harness/src/index.ts`):
- `parseBinding`, `Binding`, `LoopKind` — binding parsing
- `FLOOR_GATES`, `runGates`, `Gate`, `GateResult`, `Exec` — gate primitives
- Full layout API: `LOOPS_DIR`, `RUNS_DIR`, `runDir`, `bindingPath`, `ledgerPath`, `logPath`, `outcomePath`, `screenshotsDir`, `hostedScreenshotPath`
- `appendLedger`, `readLedger`, `LedgerEntry` — ledger
- `behaviorGate`, `ensureStack`, `parseBehaviorResult`, `reachable` — behavior gate
- `runLoop` — the core loop runner
- `buildDoerPrompt`, `buildJudgePrompt`, `extractJson`, `parseDoerResult`, `parseJudgeResult` — runner prompts
- Full type set: `BehaviorResult`, `ClaudeRequest`, `ClaudeResult`, `DEFAULT_CONFIG`, `DoerResult`, `JudgeResult`, `LoopOutcome`, `RunnerConfig`, `RunnerDeps`, `Shell`, `TerminalState`
- `listRuns`, `pruneRuns`, `readOutcome`, `RunSummary`, `PrunePolicy` — GC

**Scripts** (`pnpm --filter @carbon/harness <script>`):
- `loop <binding-path> [--cwd <worktree>] [--no-pr]` — run one loop to a gated PR
- `gates` — run floor gates
- `gc [--cwd <dir>] [--keep-last <n>] [--max-age-days <n>]` — prune finished runs

**Binding type** (TypeScript, from `binding.ts`):
```typescript
type Binding = {
  id: string;
  kind: "bug" | "feature" | "usability" | "copy";
  title: string;
  risk: "low" | "med" | "high";   // ← NOTE: "med" NOT "medium"
  acceptance: string[];
  issue?: number;
}
```

**DEFAULT_CONFIG** (runner/types.ts):
```typescript
plateauAfter: 2,
maxIterations: 8,
doerMaxTurns: 60,
doerMaxBudgetUsd: 5,
judgeMaxTurns: 20,
judgeMaxBudgetUsd: 2,
behaviorMaxTurns: 300,    // raised from 40 in #961
behaviorMaxBudgetUsd: 15  // raised from $3 in #961
```

**Floor gates** (`gates.ts`):
```typescript
FLOOR_GATES = [
  { id: "lint",        cmd: "pnpm exec biome check" },
  { id: "conformance", cmd: "pnpm --filter @carbon/checks test" },
  { id: "clobbers",    cmd: "pnpm --filter @carbon/checks clobbers" }
]
```

**`runLoop` behavior**: pure function (all side effects via `deps`). Drives: doer → floor gates → per-package typecheck → behavior gate (if `touchedUI`) → correctness gate (if `testCommand`) → judge → keep/revert/ledger → terminate. Returns `LoopOutcome: { state, iterations, reason, prUrl? }`.

**`run-loop` script**: reads binding from file, creates `runDir`, persists binding, runs loop, if `shipped` calls `openPr` (idempotent, also hosts screenshots on `loop-artifacts` branch), writes `outcome.json`.

### @carbon/checks

**Exports**: `CONFORMANCE_CHECKS`, `STRUCTURE_CHECKS`, `FLOOR_GATES`, `scanAll`, `scanModules`, `collectFindings`, `newViolations`, `Finding`, various invariant types.

**Conformance checks**: `noNumericPrecision`, `noLegacyRls`, `moduleShape`.

**Scripts**: `baseline`, `invariants`, `clobbers`.

### @carbon/dev (crbn CLI)

**Commands**: `up`, `down`, `new`, `remove`, `list`, `status`, `migrate`, `reset`, `copy`.

**Key flags for `crbn up`**:
- `--minimal` — skip Studio, Postgres-Meta, Inbucket (saves ~300–500MB RAM) — **added in #979**
- `--run <cmd>` — boot, wait until reachable, run command, tear down (headless use)
- `--volumes` — also remove Docker volumes on `--run` teardown
- `--no-apps` — services only (no ERP/MES dev servers)
- `--portless` / `--no-portless` — portless `.dev` URLs vs localhost

**Key flags for `crbn new`**:
- `--yes` — non-interactive (skips prompts; base defaults to `origin/main`)
- `--base <ref>` — base branch/commit
- `--branch <name>` — branch name

### .ai/ Knowledge System (new in #992)

The `.ai/` directory is now the single source of truth for all agent-readable rules, skills, specs, and docs. Structure:
- `.ai/skills/` — 29 skills (conductor is a core skill in `tiers.json`)
- `.ai/docs/` — outer-loop.md, loop-system.md, module-conventions.md, manufacturing/
- `.ai/lessons.md` — 3 prescriptive institutional lessons
- `.ai/scripts/install-skills.sh` — symlinks `.ai/skills/` (by tier) into `.claude/` and `.codex/`

**Current symlinks in `.claude/skills/`** (only the 5 in the default core tier that ran on install):
```
check-and-commit → ../../.ai/skills/check-and-commit
create-agents-md → ../../.ai/skills/create-agents-md
fix              → ../../.ai/skills/fix
root-cause       → ../../.ai/skills/root-cause
spec-writing     → ../../.ai/skills/spec-writing
```

**Notably absent**: `conductor`, `self-review`, `test`, `plan`, `execute`, `feature`, `improve`, `research` (all core-tier skills) are NOT currently symlinked. The `pnpm prepare` guarded install didn't run fully.

---

## 3. Specific Discrepancies (Docs vs Code vs Reality)

### 3.1 CARBON_AGENT.md — Stale Design Doc References

**File:** `/home/openclaw/.openclaw/workspace/CARBON_AGENT.md`

In the header:
```markdown
**Design docs (the full spec — this file is a distillation):**
- `llm/outer-loop/01-openclaw-plan.md` — orchestrator/builder split, triggers, wake loop, safety
- `llm/outer-loop/02-repo-changes.md` — the dispatch contract the harness exposes
- `.claude/skills/conductor/SKILL.md` + `packages/harness/` — the inner loop
```

**Reality:**
- `llm/outer-loop/01-openclaw-plan.md` → **DELETED** (git history; content condensed in `.ai/docs/outer-loop.md`)
- `llm/outer-loop/02-repo-changes.md` → **DELETED**
- `.claude/skills/conductor/SKILL.md` → **MOVED** to `.ai/skills/conductor/SKILL.md` (no symlink in `.claude/skills/`)

**Fix:** Replace header with:
```markdown
**Design docs:**
- `.ai/docs/outer-loop.md` — architecture, wake loop, safety (condensed reference)
- `.ai/docs/loop-system.md` — binding format, run layout, GC
- `.ai/skills/conductor/SKILL.md` + `packages/harness/` — the inner loop
```

---

### 3.2 CARBON_AGENT.md — Binding Format Uses Wrong Risk Value

**In CARBON_AGENT.md's Binding format section:**
```yaml
risk: low | medium | high
```

**Actual TypeScript type (binding.ts):**
```typescript
risk: "low" | "med" | "high"
```

The parser reads `scalars.risk` directly from the YAML frontmatter. If the outer loop emits `risk: medium`, `parseBinding` will accept it (no validation on risk values other than trusting the scalar), but the TypeScript type will show `"medium"` as a non-union member. More importantly, `parseBinding` doesn't validate risk — it just passes through whatever value it reads. So bindings with `risk: medium` would parse without error but be TypeScript-unsound.

**Fix:** Change `risk: low | medium | high` → `risk: low | med | high` in CARBON_AGENT.md.

---

### 3.3 agent-prompt.md — Stale Header/Invocation Example

**File:** `/home/openclaw/.openclaw/workspace/agent-prompt.md`

Header says:
```
This is the literal prompt the OpenClaw box runs each wake (heartbeat or webhook):

```bash
claude -p --dangerously-skip-permissions "$(cat llm/outer-loop/agent-prompt.md)"
```
run from the Carbon checkout.
```

**Reality:** `llm/outer-loop/agent-prompt.md` was deleted in `b4c6cdd4c`. The correct invocation (per CARBON_AGENT.md) is:
```bash
cd /home/openclaw/carbon && claude -p --dangerously-skip-permissions \
  "$(sed '1,/^---$/d' /home/openclaw/.openclaw/workspace/agent-prompt.md)"
```

Also, the header mentions `(Full design + rationale: \`01-openclaw-plan.md\`.)` — that file is gone.

**Fix:** Update header in agent-prompt.md to reflect current invocation and drop the deleted doc reference.

---

### 3.4 .ai/docs/outer-loop.md — Stale Conductor Skill Path

**File:** `/home/openclaw/carbon/.ai/docs/outer-loop.md`

In "Related Files":
```markdown
- **Conductor skill:** `.claude/skills/conductor/SKILL.md`
```

**Reality:** The conductor skill is at `.ai/skills/conductor/SKILL.md`. There is NO `.claude/skills/conductor` symlink. The only `.claude/skills/` symlinks are: check-and-commit, create-agents-md, fix, root-cause, spec-writing.

**Fix:** Change to `.ai/skills/conductor/SKILL.md`.

---

### 3.5 CARBON_AGENT.md — Outdated llm/ Gitignore Note

**In CARBON_AGENT.md "Key Paths" section:**
```
- **Loop runs (runtime, gitignored):** `llm/loops/runs/<id>/` in the Carbon repo
```

**Reality:** The entire `llm/` directory is now gitignored (not just `llm/loops/runs/`):
```
# Legacy llm/ — consolidated into .ai/ (docs, specs, runs)
llm/
```

The `llm/outer-loop/` and `llm/loops/` dirs are both runtime state (agent-state.db, daily-notes, dispatch.db, state.db, runs/). Nothing in `llm/` is tracked.

**Fix:** Change note to: "Loop runs and agent state (runtime, gitignored): `llm/` (all of it) in the Carbon repo — `llm/loops/runs/<id>/` for loop artifacts, `llm/outer-loop/` for agent-state.db and daily notes."

---

### 3.6 AGENTS.md (workspace) — Stale Conductor Path Reference

**File:** `/home/openclaw/.openclaw/workspace/AGENTS.md`

Under "Architecture" section and "**If this is a heartbeat/webhook wake:**" section, the file references:
```
`.claude/skills/conductor/SKILL.md` in the Carbon repo
```

**Reality:** No symlink exists there; the real file is `.ai/skills/conductor/SKILL.md`.

**Fix:** Update all references from `.claude/skills/conductor/SKILL.md` to `.ai/skills/conductor/SKILL.md`.

---

### 3.7 CARBON_AGENT.md — .ai/ System Not Mentioned

The extensive `.ai/` knowledge system introduced in #992 (29 skills, AGENTS.md files across 31 packages/modules, lessons.md, spec-driven development) is entirely absent from CARBON_AGENT.md. While not blocking, the conductor skill now references `.ai/lessons.md` in §2b ("capture new lessons") and builds now do a freshness audit of AGENTS.md files. An outer-loop agent following only CARBON_AGENT.md would miss this.

**Recommendation:** Add a note about the `.ai/` system and the post-build AGENTS.md freshness audit (conductor §2b) to CARBON_AGENT.md.

---

### 3.8 `.claude/skills/conductor` Symlink Missing

The `install-skills.sh` script puts conductor in the `core` tier (the default installed tier), but `conductor` is not currently symlinked in `.claude/skills/`. The present symlinks (check-and-commit, create-agents-md, fix, root-cause, spec-writing) are only 5 of the 13 core-tier skills.

This appears to be because `pnpm prepare` ran but with an older version of `install-skills.sh` (before #992 expanded the core tier), or the install was partial. Running `bash .ai/scripts/install-skills.sh` from the repo root would fix it.

**Impact:** Claude Code agents loading skills from `.claude/skills/conductor/` path would silently get nothing. The conductor skill must be loaded explicitly from `.ai/skills/conductor/SKILL.md`.

---

## 4. What Was Added/Changed in Recent Commits

### #998 (cf77e3d4d) — Fix: guard prepare script + CLAUDE.md files
- Guarded `pnpm prepare` install-skills call with `[ -f .ai/scripts/install-skills.sh ]` (Docker CI was failing)
- Added `CLAUDE.md` (containing `@AGENTS.md`) next to every AGENTS.md (34 directories) so Claude Code loads local context
- Moved `./playbooks/ → .ai/playbooks/`
- Trimmed `lessons.md` to 3 core lessons (was more verbose)

### #992 (09bdfe354) — LLM-first architecture overhaul: .ai/ knowledge system
- New `.ai/` directory as single source of truth
- `.ai/skills/conductor/SKILL.md` — conductor skill moved here (expanded with §2b freshness audit, provability hierarchy)
- `.ai/docs/outer-loop.md` — replaces deleted `llm/outer-loop/README.md` + condenses the deleted 01+02 docs
- `.ai/docs/loop-system.md` — replaces `llm/loops/README.md`
- `.ai/lessons.md` — new institutional memory file
- `.ai/scripts/install-skills.sh` — tier-based symlink installer
- Root `AGENTS.md` updated as Task Router (40+ task types mapped to guide files)
- 22 package AGENTS.md files + 9 module AGENTS.md files created
- Conductor skill updated: adds `§2b` post-build freshness audit of AGENTS.md for touched directories
- Self-review skill updated: adds docs freshness section
- `llm/` fully gitignored (was previously only `llm/loops/runs/` gitignored)
- `.claude/skills/` converted to symlinks pointing to `.ai/skills/`

### #979 (50d85f1aa) — feat: --minimal flag to crbn up
- `crbn up --minimal` skips Studio, Postgres-Meta, Inbucket (~300–500MB saved)
- Already referenced correctly in CARBON_AGENT.md

### #973 (c4d53333d) — docs(conductor): binary decomposition in judge step
- Judge step now explicitly uses binary decomposition (atomic yes/no questions per criterion)
- Conductor SKILL.md §2 step 3 updated
- Already in the current `.ai/skills/conductor/SKILL.md`

### #971 (3fc22772e) — docs(conductor): simplest-path provability hierarchy for behavior gate
- Behavior gate now: unit/integration test > visual (agent-browser) > CLI proof
- Already in the current `.ai/skills/conductor/SKILL.md` §2 step 2

### #961 (1148e8992) — fix(harness): raise behavior gate limits
- `behaviorMaxTurns`: 40 → 300
- `behaviorMaxBudgetUsd`: $3 → $15
- DEFAULT_CONFIG in `packages/harness/src/runner/types.ts` is current

### #957 (509611e4a) — Outer loop: design + harness dispatch contract
- `layout.ts` — single owner of all loop paths
- `runs.ts` — `listRuns`, `readOutcome`, `pruneRuns` + `gc` script
- `run-loop` script now writes structured `outcome.json`
- `.gitignore` previously collapsed to `llm/loops/runs/` (later expanded to entire `llm/` in #992)
- Outer-loop design docs 01+02 added (later deleted in b4c6cdd4c)

---

## 5. Recommendations

### Priority 1 — Fix broken references (will mislead the outer-loop agent)

1. **Update CARBON_AGENT.md design doc pointers:**
   - Remove `llm/outer-loop/01-openclaw-plan.md` and `02-repo-changes.md`  
   - Change `.claude/skills/conductor/SKILL.md` → `.ai/skills/conductor/SKILL.md`
   - Add `.ai/docs/outer-loop.md` and `.ai/docs/loop-system.md`

2. **Fix `risk` value in CARBON_AGENT.md Binding format:**
   - `risk: low | medium | high` → `risk: low | med | high`

3. **Update agent-prompt.md header:**
   - Remove the stale `llm/outer-loop/agent-prompt.md` invocation example
   - Update to show the real invocation from the workspace file
   - Drop the reference to `01-openclaw-plan.md`

4. **Fix `.ai/docs/outer-loop.md` conductor skill path:**
   - `.claude/skills/conductor/SKILL.md` → `.ai/skills/conductor/SKILL.md`

### Priority 2 — Accuracy improvements

5. **Update llm/ gitignore note in CARBON_AGENT.md:**
   - "Loop runs (runtime, gitignored): `llm/loops/runs/<id>/`" → entire `llm/` is gitignored

6. **Run `bash .ai/scripts/install-skills.sh`** in the carbon repo:
   - The `conductor` symlink is missing from `.claude/skills/`. Re-running install will add the full core tier. (Low urgency: Claude Code headless builds in worktrees get a fresh `pnpm install` which runs `prepare`.)

7. **Add `.ai/` system reference to CARBON_AGENT.md:**
   - Brief note about the conductor §2b AGENTS.md freshness audit step
   - Note that skills live in `.ai/skills/` (Claude Code discovers via `.claude/` symlinks)

### Priority 3 — Nice-to-have

8. **AGENTS.md (workspace) "Key Paths" section:**
   - Update "Conductor skill: `.claude/skills/conductor/SKILL.md` in the Carbon repo" → `.ai/skills/conductor/SKILL.md`

9. **Consider whether `llm/outer-loop/` runtime dirs belong there:**
   - `agent-state.db` and `daily-notes/` live in `llm/outer-loop/` on disk (gitignored). This is a vestige of the old layout. Could be moved to a cleaner location but not blocking.

---

## Summary Table

| File | Issue | Severity |
|------|-------|----------|
| `CARBON_AGENT.md` (workspace) | References deleted `llm/outer-loop/01-openclaw-plan.md`, `02-repo-changes.md`; wrong conductor path | **High** |
| `CARBON_AGENT.md` (workspace) | `risk: medium` should be `risk: med` | **High** |
| `CARBON_AGENT.md` (workspace) | llm/ gitignore note understates scope | Medium |
| `CARBON_AGENT.md` (workspace) | .ai/ knowledge system not mentioned | Low |
| `agent-prompt.md` (workspace) | Stale header references deleted `llm/outer-loop/agent-prompt.md` | **High** |
| `.ai/docs/outer-loop.md` (repo) | Conductor skill path points to non-existent symlink | **High** |
| `AGENTS.md` (workspace) | References `.claude/skills/conductor/SKILL.md` | Medium |
| `.claude/skills/conductor` (repo) | Symlink missing (install-skills.sh didn't create it) | Medium |
| Behavior gate limits | DEFAULT_CONFIG is current (300 turns / $15) — no action | ✅ OK |
| `--minimal` flag | CARBON_AGENT.md usage is correct | ✅ OK |
| Dispatch command | `crbn up --minimal --run` syntax is correct | ✅ OK |
| `outcome.json` read | `cat llm/loops/runs/<id>/outcome.json` is correct | ✅ OK |
| GC command | `pnpm --filter @carbon/harness run gc` is correct | ✅ OK |
