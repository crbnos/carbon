# Feature run: Strict backflush (CARBON-113)

- Date: 2026-10-14
- Mode: fully-autonomous
- Request: "sounds good write the spec and implement it" (after the design and decisions 1–7 in the chat)
- Phase plan: research [skip — the user resolved every decision in the chat] · spec [run] · plan [run] · execute [run] · test [skip — the user did not ask for a browser test] · self-review [run]

## Decisions

- Spec gate: every open question has a human answer from the chat ("sounds good" to recommendations 1–7). No autonomous resolution was necessary for the 7 questions. — 2026-10-14
- Spec, autonomous detail: the Pull From requirement covers Purchase to Order lines too. The BoM editor labels them "Pull From" and the backflush consumes them from a bin. — 2026-10-14
- Spec, autonomous detail: MES records the production quantity before it issues material. A strict refusal at that point would leave produced units with no consumption. The MES routes run the issue as a dry run first, only when strict backflush is on. — 2026-10-14
- Plan gate: plan approved autonomously after the STE-80 pass. — 2026-10-14
- Execute: no commits. The user's standing rule is "ask before every commit". The execute skill's per-task commit is replaced by per-task verification. — 2026-10-14

- Execute: the strict-backflush docs went into `apps/erp/app/modules/production/AGENTS.md`, not `.claude/rules/inventory-system.md`. The production module owns backflush, and rules document committed code only. — 2026-10-14
- Self-review: added a transaction-scoped advisory lock on (company, bin, item) to the TypeScript and SQL bin checks, against two completions overdrawing one bin. The migration file changed after `pnpm db:migrate` applied it locally, so the local `backflush_job_materials` has no lock until it is re-applied. — 2026-10-14
- Self-review: the DB-backed regression file `packages/server-functions/src/strict-backflush.test.ts` was not run. It creates and deletes a scratch company, and the user asks before any database write. — 2026-10-14

- Browser test (user request 2026-10-15): ran through the UI as the dev user. The user asked for the test, so the UI writes (settings, BoM edits, 2 jobs, releases, picks, completions, inventory adjustments) are part of it. A script error put 1 PCB-BARE-REV3 and 1 MAT-CONFCOAT into the unassigned bin; both were set back to 0 through the same form. The migration's function was re-applied locally (`psql -f`) to test the SQL fix. — 2026-10-15

## Phase log

- spec: `.ai/specs/2026-10-14-strict-backflush.md` — STE-80 pass done
- plan: `.ai/plans/2026-10-14-strict-backflush.md` — STE-80 pass done, all 12 tasks checked
- execute: typecheck green (`@carbon/database`, `@carbon/server-functions`, `erp`, `mes`); tests green (ERP 2054, MES 69, server functions 365, database 476, checks 305); Biome clean; clobbers clean
- self-review: lock added (above); no other must-fix
- browser test: 6 bugs found and fixed (see the spec changelog, 2026-10-15); playbook `.ai/playbooks/strict-backflush.md`; gates green again (ERP 2057, MES 69, server functions 365, database 476, checks 305)

## Outcome

- Committed and pushed on the user's request (2026-10-15), PR opened. The branch was fast-forwarded to origin/main first; the migration moved to `20261015122149_strict-backflush.sql` so it is newer than main's latest. Translations filled by `/translate` (120 strings + 14 re-translated where the glossary term was dropped).
