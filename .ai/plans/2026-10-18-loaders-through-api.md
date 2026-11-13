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
- [x] `packages/api/src/permissions.ts`: `Permissions = RequiredPermissions | "system" | "member"`
- [x] `packages/api/src/service-fn.server.ts` `allows`: `"member"` → `hasPermissions(claims, companyId, {})`
- [x] `scripts/lib/service-fn-metadata.ts` `leafPermission`: string literal `"member"` → `{ module: null, actions: [] }`
- [x] grep every other reader of a service function's `permission` (docs generator, tests) and handle `"member"`
- [x] codemod: `permission: {}` → `permission: "member"` in `apps/erp/app/modules/*/*.server.ts`
- [x] codemod: the lookup wrappers (`perm-stricter`, view-only) → `"member"` (138 service functions)
- [x] `service-fn-file` check refuses `permission: {}`; test case
- [x] verify: `pnpm --filter @carbon/api test`, `pnpm --filter @carbon/checks test`, typecheck `@carbon/api`

### B. Loader codemod (`scratchpad/loaders-codemod.ts`, ts-morph)
- [x] re-run inventory + classify after A (lookups become `auto`)
- [x] per file: `const { … } = await requirePermissions(…)` → `const auth = …; const { <names still used> } = auth; const api = carbonFor(auth);`
- [x] per call: `fn(client, companyId, a, b)` → `api.<module>.<wrapper>({ <field>: a, … })`, a whole-input arg spread (`{ ...x }`, an object literal inlined)
- [x] paged: rewrite `.data` / `.count` reads of the result binding; a binding used any other way → manual
- [x] an `unwrap` result whose `.count` is read → manual (the wrapper drops it)
- [x] imports: drop swapped names from the `.service` import (keep as `type` when only `typeof` uses remain), add `carbonFor`
- [x] dry run prints the per-file diff count; apply; `pnpm exec biome check --write` on touched files
- [x] verify: `pnpm exec turbo run typecheck --filter=erp --concurrency=1`; fix the fallout (error `.code` reads, null-vs-undefined inputs, zod refinements) by hand

### C. Manual leftovers
- [x] the 58 `manual` calls: swap by hand where the input maps, else baseline with a reason
- [x] report the 11 write-gated loader calls to the user (not changed)

### D. Guard
- [x] `packages/checks/src/conformance/loader-reads-through-api.ts` + test, copied from `route-action-shape`
- [x] baseline the remaining hits (`service-role`, write-gated, manual)
- [x] `.claude/rules/module-files.md`: a loader section (`carbonFor(auth)`, `"member"`, helpers stay direct)

### E. Verify
- [x] typecheck `erp`, `@carbon/api`, `@carbon/checks` (one at a time)
- [ ] `pnpm run lint`
- [x] `pnpm run generate:mcp`: digest changes only for the loosened permissions
- [ ] browser: `/smoke-test` plus the pages behind the loosened lookups, as a user without settings/resources view
- [ ] changelog line for the loosened API permissions (only when the user asks for the entry)

## Result (2026-10-18)

Loader calls to a wrapped building block: 1,611 → 204, all baselined in
`loader-reads-through-api` with a reason class.

| Stays direct | Calls | Why |
|---|---|---|
| service role | 122 | public share pages, PDFs, system reads |
| page types derived from the building block | 26 | change notice page, storage-unit search, item demand, quote order lines |
| write-gated, or a write on GET | 15 | `resolveSections`, `resolvePriceList`, `createAssemblyInstruction`, 6 × `upsertPickMethod` |
| another company of the group | 14 | consolidated reports, subsidiary settings |
| `unwrap` drops `.count` | 6 | the wrapper would have to page (a contract change) |
| wrapper takes a client or a Kysely `db` | 7 | Onshape auth, agent thread, out-of-service refusal, company today, period close, job receipts |
| portal-account routes | 4 | onboarding, `link` (`allowPortalAccounts`) |
| app shell | 3 | `x+/_layout` |
| `payload` stamps the group or the user | 3 | analytics lines, user select search |
| the input names another person | 2 | person attributes (the wrapper reads the caller's own) |
| bound to `authorized` with `companyId` | 2 | people shifts, outside operations: can move by hand |

Deviations: `DataOf` (`service-tools.server.ts`) fixed so `unwrap`'s data
excludes the failure branch's `null` (122 MCP response schemas lose it);
`dataOrThrow` added for plain-value service functions. Not done: browser
verification and a pass over action reads.
