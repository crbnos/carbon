# Skills rewrite — optimize for productivity and quality of execution

Branch: `skills-rewrite` (off origin/main). Complete rewrite of `.ai/skills/`.

Design principle: **write every skill for the weakest plausible executor.** Exact
commands with expected output, one canonical path per task, decision tables with
defaults, explicit STOP rules, verifiable done-criteria. No reliance on the reader
inferring intent.

## Defects being fixed

- [x] 5 skills have HTML comments ABOVE the YAML frontmatter (spec-writing,
      root-cause, fix, check-and-commit, create-agents-md) — breaks description
      parsing; the comment leaks into the trigger description.
- [x] `plan` + `execute` reference skills that don't exist (`/forms`,
      `/database-transactions`, `/verify`); `packages/form/AGENTS.md` references
      non-existent `.ai/skills/forms/SKILL.md`.
- [x] Competing artifact conventions: brainstorm→`.ai/research/*-design.md` vs
      spec-writing→`.ai/specs/{date}-{slug}.md`; plan→`.ai/plans/` vs
      AGENTS.md→`.ai/runs/`; execute tracker→`.ai/scratch/tasks/todo.md`.
- [x] `fix`/`check-and-commit`/`execute` prescribe whole-repo `pnpm run typecheck`
      (OOMs the machine per improve skill + conductor + user experience).
- [x] `check-and-commit` uses `git add -A` and unconditional push.
- [x] `plan`'s own SQL example violates repo conventions (gen_random_uuid, no
      companyId).
- [x] Three overlapping debugging skills with contradictory instructions
      (root-cause read-only vs systematic-debugging vs debugging-difficult-bugs).
- [x] `error` saves screenshots to `docs/e2e/` (NOT gitignored; pollutes the docs
      app) — move to `.ai/scratch/e2e/` (gitignored).
- [x] `conductor` references legacy `llm/loops/README.md` (gitignored/absent) and
      carries a stale "loop system not yet on main" caveat.
- [x] `improve` references `.ai/recommendations/` (doesn't exist).
- [x] `smoke-test` has a trailing-space typo in `/x/people/employee ` route.

## Canonical conventions (baked into every skill)

- Research → `.ai/research/{slug}.md`; specs → `.ai/specs/{YYYY-MM-DD}-{slug}.md`
  (lifecycle per `.ai/specs/AGENTS.md`); implementation plans + progress →
  `.ai/plans/{YYYY-MM-DD}-{slug}.md` (per Brad's 2026-07-02 correction; run logs
  stay in `.ai/runs/`); playbooks → `.ai/playbooks/{slug}.md`;
  improve handoff plans → `.ai/plans/improve/`; e2e failure captures →
  `.ai/scratch/e2e/`.
- Typecheck is ALWAYS scoped: `pnpm exec turbo run typecheck --filter=<pkg>`.
  Never `pnpm typecheck` / `pnpm run typecheck` (whole-repo; OOMs).
- Migrations: `pnpm run generate:types` BEFORE typechecking.
- Format/lint fix: `pnpm exec biome check --write <paths>`.
- Commit: stage specific paths (never `git add -A`); conventional message; push
  only if the branch tracks a remote or the user asked.

## Work items

- [x] Survey all 27 skills + wiring + cross-references (2 Explore agents + direct reads)
- [x] Rewrite core feature chain: research, spec-writing (absorbs brainstorm),
      plan, execute, feature
- [x] Rewrite bug chain: root-cause (absorbs systematic-debugging),
      debugging-difficult-bugs, fix
- [x] Rewrite gates: check-and-commit, self-review, conductor
- [x] Rewrite browser chain: login, error, smoke-test, test
- [x] Rewrite meta: create-agents-md, writing-skills, test-driven-development
- [x] Light edits: improve (broken refs incl. references/*), carbon-docs (scratch ref)
- [x] Leave unchanged: pr-explainer, pr-splitter (already correct + imperative),
      ui (remote-managed shim), agent-browser + make-interfaces-feel-better
      (external, pinned in skills-lock.json)
- [x] Delete: brainstorm (merged into spec-writing), systematic-debugging (merged
      into root-cause; useful references moved to root-cause/references/); also
      removed writing-skills' imported meta-files (persuasion-principles,
      graphviz/render-graphs, subagent-testing doc, 1150-line best-practices)
- [x] New: .ai/skills/README.md index
- [x] Update: AGENTS.md Workflows router rows + scoped-typecheck line;
      packages/form/AGENTS.md stale ref; install-skills.sh frontmatter guard
- [x] Verify: installer runs clean with guard (25 skills linked), every SKILL.md
      has line-1 frontmatter + dir-matching name + description, no references to
      deleted/phantom skills or missing files remain
- [x] Commit on skills-rewrite branch

## Wave 2 — treat ALL inherited content as suspect; harden for weak executors

- [x] Fact-checked inherited claims: smoke-test module routes verified against
      `path.ts` + `routes/x+` (all real); /login greeting verified
      (`apps/erp/app/components/Greeting.tsx`); moved reference files carry no
      stale `superpowers:` refs
- [x] Fixed nested-fence rendering bug in plan + create-agents-md templates
      (```` outer fences); added fence-balance check to the verification sweep
- [x] Added "Announce at start" to every workflow skill (building blocks,
      externals, and reference skills intentionally excluded)
- [x] Added red-flag rationalization lists at the discipline pressure points:
      spec-writing (self-resolving the gate), plan (under-specified tasks),
      execute (improvising), fix (test-after / scope creep), check-and-commit
      (gate weakening, "probably pre-existing" now requires proof), root-cause
      (fix-before-cause)
- [x] check-and-commit: mechanical changed-files→package-names snippet (weak
      models fumble the --filter mapping)
- [x] pr-splitter: full rewrite — non-interactive extraction recipes (the old
      skill prescribed `git restore -p`, which hangs in agent harnesses),
      merge-base detection, scratchpad moved to gitignored .ai/scratch/
- [x] pr-explainer: full rewrite around a bundled assets/template.html
      (styled, self-contained, `<!-- FILL -->` markers) — filling a template
      beats inventing 200 lines of HTML
- [x] writing-skills: new authoring rules 8–10 (announce, non-interactive only,
      bundle assets for generative output), four-backtick fence trap, and
      "re-verify inherited claims" added to rule 6
