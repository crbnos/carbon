# Loaders read through the service functions

Routes' loaders still call `<module>.service.ts` building blocks directly. The
API and MCP call the `defineServiceFn` wrappers of the same blocks. Two paths,
two permission gates. This plan moves every loader read that has a wrapper onto
`api.<module>.<fn>(input)`, and adds a check so no new loader adds a direct call.

Parent plan: `.ai/plans/2026-10-15-service-function-migration.md` (Phase 4
"Loaders" rule, never executed).

## Inventory (2026-10-18, scratchpad `inventory.ts` + `classify.js`)

1611 direct `.service` calls in 689 loader files.

| Class | Calls | What happens |
|---|---|---|
| `auto` | 816 | wrapper exists, its permission is covered by the route's, args map 1:1 → codemod |
| `auto-paged` | 138 | as `auto`, but `paged`: `X.data` → `X.data?.rows`, `X.count` → `X.data?.count` |
| `perm-stricter` (view) | 283 | cross-module lookup (company settings 41, locations 29, …): wrapper → `"member"`, then codemod |
| `perm-stricter` (write) | 11 | `update`/`create` gates (`resolveSections`, `resolvePriceList`, `createAssemblyInstruction` on GET, …): left direct, listed for review |
| `no-wrapper` | 251 | helpers (timezone, user defaults, label logo, `*Once`, periods): stay direct by design |
| `service-role` | 54 | system reads (share pages, public links): stay direct |
| `manual` | 58 | route passes a different company id / omits a ctx arg / `forCreate` payload: hand-review, baseline what stays |

Actions (832 direct calls) are out of scope: follow-up with the same codemod.

## Decisions

- **`"member"` permission.** A sentinel beside `"system"`: any member of the
  company (what `{}` meant). `{}` is no longer written; the 43 existing `{}`
  wrappers become `"member"`, and `service-fn-file` refuses `permission: {}`.
  RLS on the caller's client still filters rows, for users and for API keys
  (`getCarbonAPIKeyClient`), so a key without a module's scope still reads no
  rows of it.
- **Which wrappers become `"member"`:** exactly the view-only wrappers a page
  calls without holding their permission (the app already lets those users
  read them). Writes are never loosened.
- **Binding:** `const api = carbonFor(auth)` from the loader's own
  `requirePermissions` result. `carbon(request)` would authenticate twice and,
  for `bypassRls: true` routes, swap the service-role client for the user's.
- **The check derives its own rule:** a loader may not call a building block
  that some service function's `run` calls. Helpers no wrapper calls pass with
  no allow-list. What remains is baselined.

## Tasks

### A. `"member"` permission
- [ ] `packages/api/src/permissions.ts`: `Permissions = RequiredPermissions | "system" | "member"`
- [ ] `packages/api/src/service-fn.server.ts` `allows`: `"member"` → `hasPermissions(claims, companyId, {})`
- [ ] `scripts/lib/service-fn-metadata.ts` `leafPermission`: string literal `"member"` → `{ module: null, actions: [] }`
- [ ] grep every other reader of a service function's `permission` (docs generator, tests) and handle `"member"`
- [ ] codemod: `permission: {}` → `permission: "member"` in `apps/erp/app/modules/*/*.server.ts`
- [ ] codemod: the 283 lookup wrappers (`perm-stricter`, view-only) → `"member"`
- [ ] `service-fn-file` check refuses `permission: {}`; test case
- [ ] verify: `pnpm --filter @carbon/api test`, `pnpm --filter @carbon/checks test`, typecheck `@carbon/api`

### B. Loader codemod (`scratchpad/loaders-codemod.ts`, ts-morph)
- [ ] re-run inventory + classify after A (lookups become `auto`)
- [ ] per file: `const { … } = await requirePermissions(…)` → `const auth = …; const { <names still used> } = auth; const api = carbonFor(auth);`
- [ ] per call: `fn(client, companyId, a, b)` → `api.<module>.<wrapper>({ <field>: a, … })`, a whole-input arg spread (`{ ...x }`, an object literal inlined)
- [ ] paged: rewrite `.data` / `.count` reads of the result binding; a binding used any other way → manual
- [ ] an `unwrap` result whose `.count` is read → manual (the wrapper drops it)
- [ ] imports: drop swapped names from the `.service` import (keep as `type` when only `typeof` uses remain), add `carbonFor`
- [ ] dry run prints the per-file diff count; apply; `pnpm exec biome check --write` on touched files
- [ ] verify: `pnpm exec turbo run typecheck --filter=erp --concurrency=1`; fix the fallout (error `.code` reads, null-vs-undefined inputs, zod refinements) by hand

### C. Manual leftovers
- [ ] the 58 `manual` calls: swap by hand where the input maps, else baseline with a reason
- [ ] report the 11 write-gated loader calls to the user (not changed)

### D. Guard
- [ ] `packages/checks/src/conformance/loader-reads-through-api.ts` + test, copied from `route-action-shape`
- [ ] baseline the remaining hits (`service-role`, write-gated, manual)
- [ ] `.claude/rules/module-files.md`: a loader section (`carbonFor(auth)`, `"member"`, helpers stay direct)

### E. Verify
- [ ] typecheck `erp`, `@carbon/api`, `@carbon/checks` (one at a time)
- [ ] `pnpm run lint`
- [ ] `pnpm run generate:mcp`: digest changes only for the loosened permissions
- [ ] browser: `/smoke-test` plus the pages behind the loosened lookups, as a user without settings/resources view
- [ ] changelog line for the loosened API permissions (only when the user asks for the entry)
