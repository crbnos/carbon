# Port agent brief (read before you edit anything)

You are one of several agents porting the `projects-wbs-research-spec` branch onto main's
service-function architecture. Plan: `.ai/plans/2026-10-21-port-branch-onto-main-service-functions.md`.
Carry list: `.ai/runs/2026-10-21-port-carry-list.md`.

## Where and what

- Work ONLY in `/Users/barbinbrad/conductor/workspaces/carbon/kelowna-port` (branch
  `projects-port-main`). NEVER touch `/Users/barbinbrad/conductor/workspaces/carbon/kelowna`
  (another session works there).
- SHAs: MB (merge-base) `23bd5d6e0b`, FREEZE (the branch) `50c4309a9c`, MAIN `0a1bd961b2`.
- What the branch did to any file: `git diff 23bd5d6e0b 50c4309a9c -- <path>`; the branch
  version: `git show 50c4309a9c:<path>`. What main did: `git diff 23bd5d6e0b 0a1bd961b2 -- <path>`.
- For conflicted files the merge took main's side of each conflicting hunk; the branch side
  (diff3: ours / base / theirs) is in `.ai/runs/2026-10-21-port-carry/hunks/<path>.conflict`.
- Do NOT commit, do NOT run `git stash`/`checkout`/`reset`, do NOT run `crbn up/down`,
  `pnpm db:migrate`, `pnpm generate:*` or `pnpm install`. The orchestrator commits each wave.
- Do NOT edit `.ai/runs/2026-10-21-port-carry-list.md`. Write your report to
  `.ai/runs/port-notes/<your-agent-name>.md`: every carry-list line you carried (path → new
  home), every line you could not carry and why, and requests for other owners (e.g. "posting
  `create-project-billing-invoices` needs registering").

## Main's architecture (the target)

Read `.claude/rules/module-files.md`, `.claude/rules/conventions-services.md`,
`.claude/rules/conventions-forms.md` in the worktree. In short:

- `<module>.server.ts`: only `export const x = defineServiceFn({ input, permission, run })`.
  `<module>.service.ts`: every building block. Plain helper files in a module folder are
  allowed (e.g. `accounting/account-import-csv.ts`). No `index.ts` barrels; import from the
  defining file.
- A ported server function: body becomes `export async function name(ctx: ServiceContext, raw)`
  in `<module>.service.ts`, first line parses `nameInput` (zod, exported beside it), with
  `namePermission` exported beside it — the permission the branch's `defineServerFn` declared,
  UNCHANGED. Inside: `ctx.db` → `ctx.asSystem.pg`, `ctx.companyId` → `ctx.company.id`,
  `ctx.userId` → `ctx.auditUserId`. Operations call it via `run(ctx, "<name>", () =>
  service.name(ctx, input))` (`@carbon/api/service-tools.server`).
- Old `serverFns.system({ db, companyId, userId }).invoke("x", input)` in ERP code →
  `invokePosting(handlesOrCtx, "x", input, service.x)` / `invokePostingOrThrow`
  (`~/modules/shared/shared.service`). `serverFns.as({ client, ... })` → handles with
  `client` plus `{ as: xPermission, schema: xInput }`. Jobs and ee → `posting(...)` from
  `@carbon/api/postings.server`. MES → `erpPosting(...)` (`apps/mes/app/services/erp.ts`).
- Errors: `@carbon/api/errors` (`InvalidInputError`, `NotFoundError`, `ForbiddenError`,
  `ServerFnError`, …).
- Route actions: `validator(schema).request(args, { params })` → `carbon(request).<m>.<op>(…)`
  → return / `respond(request, result).redirect(...)`. Logic that the branch put inside a
  route action (company-record checks, charge-number checks, budget checks, refusals) moves
  into the operation or its building block. `route-action-shape` refuses writes in routes.
- Look at how main already ported a sibling before writing (e.g. `postReceipt` at
  `apps/erp/app/modules/inventory/inventory.service.ts`, `voidReceipt` in
  `inventory.server.ts`, `closeJob` in `production.server.ts`).

## Homes decided for the branch's shared libraries (D2)

| Branch file (`packages/server-functions/src/…` at FREEZE) | New home |
|---|---|
| `lib/stock-stripes.ts` | `packages/api/src/stock-stripes.ts`, export `@carbon/api/stock-stripes` (MES needs `trackedEntityStripe`) |
| `lib/project-posting.ts` | `apps/erp/app/modules/projects/project-posting.ts` (plain server-only file) |
| `lib/project-cip.ts` | `apps/erp/app/modules/projects/project-cip.ts` |
| `lib/project-journal.ts` | `apps/erp/app/modules/projects/project-journal.ts` |
| `lib/service-orders.ts` | `apps/erp/app/modules/service/service-orders.ts` |
| `lib/project-revenue.ts` | decided by the accounting agent: one copy of the code; ee reaches it through `@carbon/api` or by the ERP passing it in |
| other branch lib changes (calculate-cogs, post-adjustment, plan-adjustment, storage-units, company-records, void-cost-ledger) | main's copies in `apps/erp/app/modules/shared/shared.service.ts` / `inventory.service.ts` |

## Rules

- Preserve behaviour. Carry every branch change; do not invent new behaviour, do not drop
  main's. Where both sides changed one thing, keep both intents and note it in your report.
- Keep the SPDX header on new files: run `pnpm --filter @carbon/checks license-headers -- <path>`
  after `git add -N <path>` (the fixer only sees tracked files); then `git reset -q -- <path>`.
- Log before you throw (`getLogger`), no JS `Date`, no N+1 queries, `companyId` on every query.
- Only edit the files your task owns. If you need a change in a file you don't own, write the
  request in your report.
- Typecheck the ERP: `cd apps/erp && npx tsgo --noEmit 2>&1 | grep -E '<your paths>'`
  (about 45 s; run `npx react-router typegen` first if route types are missing). Other
  agents work in parallel, so errors outside your files are not yours. Other packages:
  `pnpm exec turbo run typecheck --filter=<pkg>`.
- Run `npx biome check --write <your files>` before you finish.

## Phase 8 (tests)

- Live-database tests run against this worktree's own stack (already up, migrated). Load its
  env first, or the tests hit another stack: `source /tmp/port/env.sh` (sets SUPABASE_DB_URL
  etc. from `.env.local`). Then e.g. `cd apps/erp && npx vitest run test/database/<path>`.
  Never run `crbn up/down`, `db:migrate`, or reset the database.
- Main's fixtures: `apps/erp/test/database/fixtures/` (`local-database.ts` → `databaseTest`,
  `always-post.ts` → a system `ServiceContext` as `service`, `handles.ts` → `handlesOf(ctx)`).
  Main's call pattern: `invokePosting(handlesOf(f.ctx), "post-receipt", {...}, postReceipt)` with
  bodies imported from `../../../app/modules/<m>/<m>.service`. Look at a test main already moved
  (e.g. `apps/erp/test/database/post-receipt/*.test.ts`) before writing.
- A test that fails is a finding, not something to bend: if a ported test fails, decide whether
  the port lost behaviour (fix the module code if it is clearly a port slip, and say so) or the
  test's expectation depends on old plumbing (adapt the plumbing only). Never weaken an
  assertion about posted amounts, accounts, quantities or stripes.
