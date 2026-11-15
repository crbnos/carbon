# Typecheck speed

Goal: make a changed-file ERP typecheck fast while keeping the same error coverage.

- [x] Measure the pipeline: `@carbon/utils` checked in 3.53 s; React Router
  type generation took 9.77 s; ERP `--noCheck` took 10.74 s across 12,541 files.
- [x] Trace a bounded ERP semantic check. The longest expressions were Kysely
  queries in `packages/database/src/legacy-documents.ts` and
  `apps/erp/app/modules/purchasing/purchasing.service.ts`.
- [x] Pilot incremental compiler state in ERP and include its build info in
  Turbo outputs. Biome, `tsc --showConfig`, and Turbo's dry run pass.
- [x] Pilot a query result type boundary and generated database declarations in
  an isolated worktree. The query boundary shrank `legacy-documents.d.ts` from
  16 MB to 17 KB, but did not make a full ERP check finish within four minutes.
  The declaration boundary reduced cold checking, but did not fix slow edits to
  the purchasing service. Neither experimental change was kept.
- [x] Measure completed checks. In the isolated pilot, source-only incremental
  ERP checking passed cold in 186.18 s, unchanged in 3.13 s, and after an
  ordinary route edit in 4.10 s. An edit to the 13,781-line purchasing service
  still took about 102 s. The actual checkout's `pnpm --filter erp typecheck`
  passed cold in 146.32 s and unchanged in 4.81 s, including route typegen.
- [x] Reach a fast unchanged and ordinary-edit check without reducing type
  coverage. Cold checks and edits to the largest service files remain slow.

Trace evidence attributes most semantic-check time to large service files and
`packages/database/src/legacy-documents.ts`, not generated files. A declaration
boundary for `@carbon/database` reduced a cold pilot from 204.73 s to 158.03 s,
but it did not make edits to the purchasing service fast (101.62 s). Splitting
the large services along real module boundaries and publishing simple explicit
types may improve those edits; moving code between files alone has not been
measured and is not assumed to help. `.claude/rules/module-files.md` currently
requires one `<module>.service.ts` per module, so that work changes architecture
and needs its own scoped plan and approval under `AGENTS.md`.
