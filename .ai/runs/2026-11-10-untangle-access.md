# Untangle: the page-level access system

Scope: everything page-level permissions touches (PR #1958). The user chose two additions:
**Comments** (remove comments that only restate the code) and **Tests** (remove tests that would not
catch a real bug, and fix the ones that fail without one).

Problem lists: four read-only surveys, 219 bullets in total.
- `.ai/scratch/untangle-U1-database.md`: registry, resolvers, authz rules, migrations
- `.ai/scratch/untangle-U2-auth-api.md`: gate evaluation in auth, api and the client
- `.ai/scratch/untangle-U3-erp-gating.md`: how ERP names and checks pages
- `.ai/scratch/untangle-U4-editors-writes.md`: grant editors and write paths

Behavior must not change, apart from bugs a fix removes. Every such bug is listed under its fix.

## Fixes, each above the problems it removes

**F1. The registry is the only vocabulary.** The page files define the module ids. The enum labels
(`Parts`), `LEVELS`, the actions, the action↔level map and the `<key>_<action>` grammar are exported
once from `@carbon/database/access`. Everything else derives from them or calls them. Validators refuse
modules that have no pages.
- The module list is kept by hand in 4 places, the enum included (U1).
- The `Inventory`↔`inventory` case mapping is done in 6 places, and writers capitalize by hand in 10+
  places (U1, U4).
- 7 copies of the action↔level map, 7 regexes for the key grammar, and 3 `GateLevel`/`LEVEL_ACTION`
  copies (U1, U2).
- Each grant stores the module twice, and `deleteAccessGrant` compares modules case-sensitively (U4).
- `Items`, `Messaging` and `Printing` type-check as grant modules (U1, U4).
  - **Bug:** the Console Operator `Items` grant matches nothing. It was a no-op on main too, so the row
    is dropped and behavior stays the same.
- `apiKeyModules` is a hand copy of the module list (U4). `useModules` copies the module ids and
  labels (U3). `SPEC_PAGE_COUNTS` repeats the registry (U1).

**F2. One gate evaluator, `holdsGate`, with an explicit read mode.** It covers `anyOf`, one meaning for
the empty gate, and one level map. Page gates (routes, sidebars, UI) stay exact. Data reads (service
functions, `ctx.can` on reads, the MCP generator) ask for `{ reads: true }`, which widens View to the
pages the registry says read the table. The widening lives here and nowhere else.
- `hasPermissions`, `meetsRequirement`, the auth `hasPermission` wrapper and the jobs `hasPermission`
  name clash repeat `holdsGate` (U2).
- `readGate` in `defineServiceFn` and a re-implementation in `service-fn-metadata.ts` (an AST walk
  that changes together with `permissions.ts`, 8 of the last 10 commits) (U2).
- `{}` means four different things, and falsy levels are handled differently (U2).

**F3. One caller check, `admits(actor, companyId, requirement)`.** It owns the system actor, portal
accounts, the company role, `"employee"` and API-key membership. The route gate, the Onshape panel,
service functions, postings, the workflow owner check and `hasListPermission` all call it. The empty
gate then means "an employee of the company, or one of its API keys". `role: "employee"` becomes the
default and is deleted from routes, lists and sidebars. `allowPortalAccounts` stays as an option.
- The portal refusal is written 5 times (U2).
- `"employee"` is inverted between service functions and postings (U2).
- A user with no role in the company passes a gate-less `authorize` (U2).
- `role: "employee"` is set on 192 routes, 63 lists and 87 sidebar entries, with 35 list/sidebar
  disagreements (U2, U3).
- `refuseKeyWithout`, the hard-coded role in `contextFromAuthed`, the three copies of "system holds
  everything", the panel copy, and the hand copy in `table-jobs.ts:28-40` (U2, U3).
- Postings authenticate API keys a second way, re-hashing the key and skipping the cache and rate
  limit (U2).

**F4. One claims constructor, `claimsFor(json, companyId)`.** The company id is required. It returns
the expanded claims plus the role. All callers use it.
- 5 copies of `expandClaims(claimsFromJson(…))`, the optional `companyId` trap, the duplicated
  `auditedClaims`, and the claims→flat→claims round trip (U2).

**F5. One subject-level function, `levelOf(subject, page)`.** It returns the level, its source and the
clamped level. It covers Admin (same company), a person's page and module grants, the role's page and
module grants, and the page's `maxLevel`. `cases.json` tests it, clamping included. `resolve.ts`,
`AccessGrid`, `bulkEditGrants`, `readEffectiveAccess` and `readPageAccessHolders` call it.
- The fallback order is decided in 5 places, and they disagree on clamping and on Admin's company
  (U4).
  - **Bug:** a role with Full on a View-only page shows View in the grid but resolves to Full.
  - **Bug:** the TS readers don't check that the Admin type belongs to the employee's company.
- "Is this the Admin type" is decided in 11 places, and one branch is dead (U4).
- `get_claims` holds a third copy of the precedence and the Admin check (U1).

**F6. One grant-write entry point in `@carbon/ee`, for every subject.** That means role, person, API
key and console. It owns the ownership check, the entitlement (checked once), clamping, server-side
subject rules, the transaction, cache clearing (people, role members and the key hash) and one audit
event shape. The subject rules are which modules a key may hold, and Accounting ≤ Edit for keys.
Writers never clear caches by hand. Grants cross every form as one validated `grantsField`.
- 7 write paths, each with its own checks, cache clearing and audit (U4).
- About 13 hand `redis.del` sites, and the API-key cache is cleared only in the ERP (U2, U4).
- API-key and console grant writes have no audit event (U4).
- The entitlement is checked 4 times per person save (U4).
- Deleting one grant rewrites the whole set and erases its conversion notes (U4).
- The Accounting cap exists only in the form, and the key module list is not enforced on the server
  (U4).
- Every form parses the grant JSON by hand, and the bulk route has its own try/catch (U4).

**F7. Page-of-a-URL and page-of-a-row come from the registry.**
- `pageOfUrl(url)` uses `paths`, longest match wins. Sidebars derive `page` from `to`. `isActive`
  defaults to the longest match. One shared `visibleGroups` filter. A conformance test checks that
  each route's gate names `pageOfUrl(route)`, or lists why not.
- `landingOf(module, claims)` is shared by the nav and every module `_index` redirect.
- `pageOfRow(table, row)` uses `where`.

Problems it removes:
- 175 hand-kept sidebar `page:` values; the filter copied 16 times in 4 shapes; 3 hand-written
  longest-path `isActive` functions; the substring active check (U3).
- No test checks route gates against the registry. They already disagree (U3):
  - the part rental-rate routes;
  - the work-center rule routes;
  - `projects/timesheets/$employeeId`;
  - Issue to Project.
- The `_index` redirects send everyone to one fixed page, so people without it get a 403. That is a
  second landing copy (U3).
- Record→page maps repeated by hand (U3):
  - the memo party ternary, 10 times in 5 files;
  - `RUN_PAGES.page`;
  - `DOCUMENT_EDIT_RECORDS.page`;
  - `importPermissions`;
  - the `PaymentDocuments` ternary, which also has a **bug**: a Project Contracts holder can't see a
    contract's deposit;
  - the `?type=` page in `items+/$itemId.properties.tsx`.
- The multi-page contract read gate is spelled 14+ ways. It becomes one exported gate (U3).

**F8. Bulk actions derive from what they run.** The gate is the service function's own `permission`,
and the list keys are the list objects.
- `BULK_ACTIONS` gate copies, `ITEM_LIST_TYPES`, the `lists: ["jobs"]` strings, and the misleading
  "action route's check" doc (U3).

**F9. The manifest stops naming what the registry decides.**
- A table's module and default read come from `placeOf(table)`.
- Rule builders take the table explicitly instead of the `rendering` global, so `exists` resolves
  against its parent.
- A module read is one SQL call that takes the module (`holds_module_view(company, 'inventory')`)
  instead of a list of every page id. Adding a page no longer regenerates every policy in its module.
- Per-page exceptions live on the page: `alsoWrittenBy` replaces `writesAlso`, and `modelUpload` and
  `anyItemPage` move there too.
- A registry lint refuses same-module `readers` and string booleans in `where`.
- All of this PR's generated migrations are unshipped, so they fold into **one** generated migration
  after the hand-written ones. That also means one lock window instead of four.

Problems it removes:
- 239 `company("<module>")` arguments and 139 `read: "<module>_view"` repeats (U1).
- The `rendering` global; `exists` ignoring its parent; `grantRows` duplicating the registry's
  `permission` split (U1).
- The 1,367-, 769- and 461-policy migrations, and the "registry edit ⇒ migration" chain (U1).
- `writesAlso` and the moved-tables migration are two halves of one decision with nothing linking them
  (U1, U4).
- The `modelUpload` contradiction, 13 no-op `readers`, and the contact `"true"`/`"false"` strings (U1).

**F10. The deploy transition sits behind one marker.**
- The legacy claims on both sides and the dead `has_any_company_permission` helper get one named
  removal checklist, in `packages/database/AGENTS.md`.
- The portal gets its own claims field instead of riding in the page map.

Problems it removes:
- The legacy-shim copies; the dead helper; portal keys mixed into `expandClaims` (U1, U2).

## Kept as they are, with the reason

- **`paths` stays on the page in the registry.** U1 suggested moving it to ERP, but `pageOfUrl` and
  `landingOf` (F7) need it next to the page.
- **SQL resolver tests in CI.** That needs a migrated database in CI: a pipeline change to propose,
  not do here. `cases.json` stays the shared contract.
- **Record URL builders** (`recordPath`, item type → URL). They are about URLs, not access, so they are
  outside this scope.

## Plan

1. `@carbon/database/access` core: F1, F2, F4, F5, F7 helpers.
   - At the same time, `@carbon/database/authz` and migrations: F9.
2. Callers:
   - auth and api: F2, F3, F4;
   - ee, jobs and the editors: F5, F6;
   - ERP navigation and gates: F7, F8, F3 role flags;
   - F10.
3. Comments pass.
4. Re-survey until there is nothing worth fixing.
5. Tests pass.
6. Full verification: every check, plus the 173-page one-page-role pass.

## Progress
- [ ] 1 core — [ ] 1 authz — [ ] 2 auth/api — [ ] 2 ee/editors — [ ] 2 ERP — [ ] F10
- [ ] comments — [ ] re-survey — [ ] tests — [ ] verify
