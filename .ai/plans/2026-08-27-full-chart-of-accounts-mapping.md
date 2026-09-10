# Full Chart-of-Accounts Mapping — implementation plan

**Spec:** .ai/specs/2026-08-27-full-chart-of-accounts-mapping.md
**Research:** .ai/research/full-coa-account-mapping-ui.md
**Branch:** athens (current workspace branch)

## Progress
- [x] Task 1: `@carbon/ee` — add `getFullChartMappableAccounts` reader + widen `matchAccountsByCode` to the full chart
- [x] Task 2: `@carbon/ee` — add `getAccountsBlockingSync` reader (parked `UNMAPPED_ACCOUNTS` journals → accounts)
- [x] Task 3: Loader — feed the new data into the Account Mapping tab, remove the accountDefault filter, pass `focusAccountIds`
- [x] Task 4: UI — restructure `AccountMapping.tsx` into Needs attention / Mapped / All accounts, with search, type grouping, badges, and focus-highlight
- [x] Task 5: UI — add a "Map accounts" deep-link from parked `UNMAPPED_ACCOUNTS` rows in `SyncActivity.tsx`
- [~] Task 6: Browser verification via `/test` — deferred to the user (no accounting provider connectable locally)

## Dependencies
- Task 2 depends on Task 1 only to serialize edits in the same package (different files, safe either order otherwise).
- Task 3 needs Tasks 1 + 2 (imports the new readers).
- Task 4 needs Task 3 (consumes the new props).
- Task 5 needs Task 4 (the focus prop makes the link land on the right row); the link itself is independent.
- Task 6 needs Tasks 3–5.

**No migration. No schema change. No `generate:types` step** — all tables/columns already exist (`externalIntegrationMapping`, `accountingSyncOperation`, `account`).

---

## Task 1: `@carbon/ee` — add `getFullChartMappableAccounts` + widen `matchAccountsByCode`

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/accounting/core/account-mapping.ts` — add one reader + one exported type; widen `matchAccountsByCode`
- Copy from (precedent): the existing `getUnmappedPostingAccounts` (line ~370) and `matchAccountsByCode` (line ~428) in the same file

**Context (verified):**
- All readers here are Kysely: `type Db = Kysely<KyselyDatabase> | KyselyTx` (line 29). Each returns `Promise<{ data, error }>` and uses `toErrorMessage(err)` in the catch.
- `getCompanyGroupId(db, companyId)` already exists in this file and is used by `getUnmappedPostingAccounts` / `matchAccountsByCode`.
- The `account` table has `class` (`glAccountClass`: Asset/Liability/Equity/Revenue/Expense) and `accountType` (finer enum), both nullable; leaf accounts are `isGroup = false`, `active = true`; chart is scoped by `companyGroupId`.
- `ACCOUNT_MAPPING_ENTITY_TYPE = "account"` (line 22).

**Steps:**

1. Add an exported type near the other exported row types (e.g. after `UnmappedPostingAccount`):
   ```ts
   export type MappableChartAccount = {
     id: string;
     number: string | null;
     name: string;
     class: string | null;
     accountType: string | null;
   };
   ```

2. Add the full-chart reader (mirror `getUnmappedPostingAccounts`'s structure, but no accountDefault / mapped filtering — this returns every leaf account so the UI can map any of them):
   ```ts
   export async function getFullChartMappableAccounts(
     db: Db,
     args: { companyId: string }
   ): Promise<{ data: MappableChartAccount[] | null; error: string | null }> {
     try {
       const companyGroupId = await getCompanyGroupId(db, args.companyId);
       if (!companyGroupId) {
         return {
           data: null,
           error: `No company group found for company ${args.companyId}`
         };
       }
       const accounts = await db
         .selectFrom("account")
         .select(["id", "number", "name", "class", "accountType"])
         .where("companyGroupId", "=", companyGroupId)
         .where("isGroup", "=", false)
         .where("active", "=", true)
         .orderBy("number", "asc")
         .execute();
       return {
         data: accounts.map((a) => ({
           id: a.id,
           number: a.number ?? null,
           name: a.name,
           class: (a.class as string | null) ?? null,
           accountType: (a.accountType as string | null) ?? null
         })),
         error: null
       };
     } catch (err) {
       return { data: null, error: toErrorMessage(err) };
     }
   }
   ```

3. Widen `matchAccountsByCode` (line ~428) to the full chart. In the current body:
   - **Delete** the accountDefault block:
     ```ts
     const accountDefaultIds = await loadAccountDefaultAccountIds(db, args.companyId);
     if (accountDefaultIds.length === 0) {
       return { data: [], error: null };
     }
     ```
   - **Delete** the clause `.where("id", "in", accountDefaultIds)` from the `account` select.
   - **Keep** the remaining leaf filters exactly: `.where("companyGroupId", "=", companyGroupId)`, `.where("isGroup", "=", false)`, `.where("active", "=", true)`, `.where("number", "is not", null)`.
   - Update the code comment above that select to state that the full chart is now matched by code (not just the accountDefault set).
   The `proposeAccountMatchesByCode(...)` call below it is unchanged — it already excludes already-mapped Carbon ids and already-used external ids via `mappedAccountIds` / `mappedExternalIds`.

4. Confirm both new/changed functions are re-exported: `packages/ee/src/accounting/index.ts` already does `export * from "./core/account-mapping";` — no change needed, but verify the line is present.

**If** `class` or `accountType` is not a selectable column on `account` in `KyselyDatabase` (compile error on the `.select`), STOP and report — do not cast; it means the generated types are stale and need regeneration first.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: "Tasks: 1 successful", no TS errors. The new getFullChartMappableAccounts
# and the edited matchAccountsByCode compile.
```

**Out of scope:** Do NOT touch `getUnmappedPostingAccounts` (it stays accountDefault-scoped — it is the "required, unmapped" list). Do NOT touch `getAccountMappings` (already unscoped). Do NOT change the AI matcher `suggestAccountMatchesWithAI` (stays required-set-scoped by virtue of being fed `unmapped`).

---

## Task 2: `@carbon/ee` — add `getAccountsBlockingSync` reader

**Depends on:** Task 1 (same package; serialize)
**Files:**
- Modify: `packages/ee/src/accounting/core/operations.ts` — add one reader
- Copy from (precedent): `failOperation` (line ~566) in the same file for the `SupabaseClient<Database>` + `syncOperationTable(client)` (`client.from("accountingSyncOperation" as any)`, line ~124) access pattern

**Context (verified):**
- `accountingSyncOperation` is accessed via `as any` here because it is outside the supabase-js generated types — so this reader MUST use supabase-js (`SupabaseClient<Database>`), NOT Kysely. This is why it lives in `operations.ts`, not `account-mapping.ts`.
- A parked journal is `status = 'Warning'`, `errorCode = 'UNMAPPED_ACCOUNTS'`, `metadata` JSONB carrying `unmappedAccountIds: string[]` (written by `runJournalEntryPreflight` in `posting.ts`, merged into the row by `getSyncOperationFailureRecord` → `failOperation`).
- `externalIntegrationMapping` and `account` ARE in the supabase-js types.

**Steps:**

1. Add the reader (place it near the other query helpers in `operations.ts`; it uses the same `SupabaseClient<Database>` import the file already has):
   ```ts
   /**
    * Accounts currently blocking a sync: the distinct account ids named by
    * parked UNMAPPED_ACCOUNTS journal operations (metadata.unmappedAccountIds),
    * minus any that have since been mapped. Feeds the "Blocking sync" rows in
    * the Account Mapping tab so an arbitrary (non-posting-default) account that
    * held up a journal is surfaced with a mapping control.
    */
   export async function getAccountsBlockingSync(
     client: SupabaseClient<Database>,
     args: { companyId: string; integration: string }
   ): Promise<{
     data: Array<{ id: string; number: string | null; name: string }> | null;
     error: string | null;
   }> {
     const ops = await client
       .from("accountingSyncOperation" as any)
       .select("metadata")
       .eq("companyId", args.companyId)
       .eq("integration", args.integration)
       .eq("status", "Warning")
       .eq("errorCode", "UNMAPPED_ACCOUNTS");
     if (ops.error) return { data: null, error: ops.error.message };

     const accountIds = new Set<string>();
     for (const op of (ops.data ?? []) as Array<{
       metadata: { unmappedAccountIds?: unknown } | null;
     }>) {
       const ids = op.metadata?.unmappedAccountIds;
       if (Array.isArray(ids)) {
         for (const id of ids) {
           if (typeof id === "string" && id.length > 0) accountIds.add(id);
         }
       }
     }
     if (accountIds.size === 0) return { data: [], error: null };

     const mapped = await client
       .from("externalIntegrationMapping")
       .select("entityId")
       .eq("entityType", "account")
       .eq("integration", args.integration)
       .eq("companyId", args.companyId);
     if (mapped.error) return { data: null, error: mapped.error.message };
     const mappedSet = new Set((mapped.data ?? []).map((r) => r.entityId));

     const remaining = [...accountIds].filter((id) => !mappedSet.has(id));
     if (remaining.length === 0) return { data: [], error: null };

     const accounts = await client
       .from("account")
       .select("id, number, name")
       .in("id", remaining)
       .order("number", { ascending: true });
     if (accounts.error) return { data: null, error: accounts.error.message };
     return { data: accounts.data ?? [], error: null };
   }
   ```

2. Confirm it is re-exported: `packages/ee/src/accounting/index.ts` already has `export * from "./core/operations";` — verify, no change expected.

**If** `operations.ts` does not already import `SupabaseClient` / `Database`, add `import type { SupabaseClient } from "@supabase/supabase-js";` and `import type { Database } from "@carbon/database";` (match how `failOperation`'s signature references them).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no TS errors; getAccountsBlockingSync compiles.
```

**Out of scope:** Do not add an index or generated column on `metadata`. Do not read the sync-activity paginated list — this is a dedicated scan of parked warnings only.

---

## Task 3: Loader — wire the new data into the Account Mapping tab

**Depends on:** Tasks 1, 2
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — `getAccountMappingTabData`, its call site, and the `<AccountMapping>` props
- Copy from (precedent): the existing `getAccountMappingTabData` (lines 183–228) and the `<AccountMapping>` render block (lines 1674–1688)

**Context (verified):**
- Loader auth returns `{ client, companyId, companyGroupId }` (line 503). `client` = supabase-js (request-scoped); `getDatabaseClient()` = Kysely.
- `getAccountMappingTabData(companyId, integrationId, chart)` builds `db = getDatabaseClient()` internally and returns `{ mappings, unmapped, chart, proposals }`; the call site is line 859–861.
- Imports from `@carbon/ee/accounting` are at line 36.

**Steps:**

1. Add the two new readers to the import from `@carbon/ee/accounting` (line ~36): `getFullChartMappableAccounts`, `getAccountsBlockingSync` (alongside the existing `getAccountMappings`, `getUnmappedPostingAccounts`, `matchAccountsByCode`, `loadAccountDefaultAccountIds`, `upsertAccountMapping`, `suggestAccountMatchesWithAI`).

2. Change `getAccountMappingTabData`'s signature to also take the supabase-js `client` (needed for `getAccountsBlockingSync`):
   ```ts
   async function getAccountMappingTabData(
     client: SupabaseClient<Database>,
     companyId: string,
     integrationId: string,
     chart: Array<{ id: string; code: string; name: string }>
   ) {
     const db = getDatabaseClient();

     const [mappings, unmapped, proposals, accountDefaultIds, allAccounts, blocking] =
       await Promise.all([
         getAccountMappings(db, { companyId, integration: integrationId }),
         getUnmappedPostingAccounts(db, { companyId, integration: integrationId }),
         chart.length > 0
           ? matchAccountsByCode(db, {
               companyId,
               integration: integrationId,
               providerAccounts: chart
             })
           : Promise.resolve({ data: [], error: null }),
         loadAccountDefaultAccountIds(db, companyId),
         getFullChartMappableAccounts(db, { companyId }),
         getAccountsBlockingSync(client, { companyId, integration: integrationId })
       ]);

     for (const result of [mappings, unmapped, proposals, allAccounts, blocking]) {
       if (result.error) {
         console.error("Failed to load account mapping data:", result.error);
       }
     }

     return {
       mappings: mappings.data ?? [], // NOTE: accountDefault filter removed — show all mappings
       unmapped: unmapped.data ?? [],
       chart,
       proposals: proposals.data ?? [],
       requiredAccountIds: accountDefaultIds,
       allAccounts: allAccounts.data ?? [],
       blocking: blocking.data ?? []
     };
   }
   ```
   The old `mappableIds` / `scopedMappings` filter block (lines ~211–220) is **removed**.

3. Update the call site (line ~859–861) to pass `client`:
   ```ts
   const accountMapping = isAccountingInstalled
     ? await getAccountMappingTabData(client, companyId, integrationId, chartAccounts)
     : null;
   ```
   (`SupabaseClient` / `Database` types are already imported in this route; if not, add the type imports.)

4. In the default export component, read the focus param from the URL and pass the new props to `<AccountMapping>` (render block ~1674–1688). `searchParams` is already available (used for `tab` at ~1751). Add:
   ```tsx
   <AccountMapping
     tabs={tabBar}
     mappings={accountMapping.mappings}
     unmapped={accountMapping.unmapped}
     chart={accountMapping.chart}
     proposals={accountMapping.proposals}
     requiredAccountIds={accountMapping.requiredAccountIds}
     allAccounts={accountMapping.allAccounts}
     blocking={accountMapping.blocking}
     focusAccountIds={searchParams.getAll("focusAccount")}
   />
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no TS errors. (AccountMapping prop types are added in Task 4; if this
# task is typechecked before Task 4, expect prop-type errors on the new props —
# that is acceptable mid-plan, but run this Verify AFTER Task 4 for a clean pass.)
```

**Out of scope:** Do not change the other tabs (`posting`, `dimensions`, `sync-activity`) or the chart-fetching blocks. Do not change action handlers — `upsert-account-mapping` / `bulk-upsert-account-mappings` already accept any `accountId`.

---

## Task 4: UI — restructure `AccountMapping.tsx` (Needs attention / Mapped / All accounts)

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/settings/ui/Integrations/AccountMapping.tsx`
- Copy from (precedent): this same file — reuse `MappingSection` (lines 220–259) and `AccountMappingRowForm` (lines 261–378) unchanged in contract, plus `Combobox`/`Submit`/`ValidatedForm` from `@carbon/form`; for the search input use `Input` from `@carbon/react`

**Context (verified):**
- Props today: `{ tabs, mappings, unmapped, chart, proposals }`. Rows are `AccountMappingRowForm` keyed by account id. There is NO search / pagination / virtualization today.
- Local mirror types: `AccountMappingRow`, `UnmappedAccountRow`, `AccountMappingChartAccount`, `AccountMatchProposalRow`.
- The `class` values for grouping: `Asset`, `Liability`, `Equity`, `Revenue`, `Expense` (null → group as "Other").
- Lessons: **no nested `max-h` + `overflow-y-auto` scroll region** — bound the long list with the collapse toggle + search, let the page scroll.

**Steps:**

1. Extend the props type:
   ```ts
   export type AllAccountRow = {
     id: string;
     number: string | null;
     name: string;
     class: string | null;
     accountType: string | null;
   };

   type AccountMappingProps = {
     tabs?: ReactNode;
     mappings: AccountMappingRow[];
     unmapped: UnmappedAccountRow[];
     chart: AccountMappingChartAccount[];
     proposals: AccountMatchProposalRow[];
     requiredAccountIds: string[];
     allAccounts: AllAccountRow[];
     blocking: UnmappedAccountRow[];
     focusAccountIds?: string[];
   };
   ```

2. Add an optional `badge?: ReactNode` prop to `AccountMappingRowForm` and render it inline next to the account name block (after the `<span>` for `accountName`, before the arrow). Keep all existing behavior. Also add an optional `rowRef?: (el: HTMLDivElement | null) => void` and `highlighted?: boolean` — wrap the form's outer element so the parent can scroll to and briefly ring it (`className={highlighted ? "ring-2 ring-primary rounded-md" : undefined}`).

3. In the top-level `AccountMapping` component, compute the derived lists with `useMemo`:
   - `requiredSet = new Set(requiredAccountIds)`
   - `mappedById = new Map(mappings.map(m => [m.accountId, m]))`
   - **Needs attention** = union of `unmapped` (badge `<Trans>Required</Trans>`) and `blocking` (badge `<Trans>Blocking sync</Trans>`), deduped by id. If an id is in both, show once with the `Blocking sync` badge (it is the more urgent signal). Exclude any id already present in `mappedById` (defensive — a mapped account is neither required-unmapped nor blocking).
   - **Mapped** = `mappings` (all). Show a `Required` badge when `requiredSet.has(mapping.accountId)`.
   - **All accounts** = `allAccounts`, filtered by the search term (case-insensitive match on `number` OR `name`), grouped by `class` (order: Asset, Liability, Equity, Revenue, Expense, Other). Each row seeds its current mapping from `mappedById.get(account.id)` (so already-mapped accounts show their provider account).

4. Add state: `const [search, setSearch] = useState("")` and `const [showAll, setShowAll] = useState(false)`. The "All accounts" group renders only when `showAll || search.trim().length > 0`.

5. Replace the two-section body with three regions inside the existing `<DrawerBody className="gap-6">`, keeping `{tabs}`, the intro `<p>`, and the existing `HStack` of "Suggest with AI" / "Match by code" buttons (unchanged — those still gate on `chart.length > 0` and `canUpdate`; "Suggest with AI" still gates on `unmapped.length > 0` because AI stays required-set-scoped):
   - `<MappingSection title={<Trans>Needs attention</Trans>} ...>` rendering the deduped needs-attention rows via `AccountMappingRowForm` with the appropriate `badge`. `emptyMessage={<Trans>Nothing needs mapping</Trans>}`.
   - `<MappingSection title={<Trans>Mapped accounts</Trans>} ...>` as today, now from the full `mappings`, with the `Required` badge where applicable.
   - A new **All accounts** block: a header row with a controlled search `Input` (icon `LuSearch` from `react-icons/lu`) and a "Show all accounts" toggle `Button` (`variant="secondary"`, flips `showAll`). Below it, when visible, render the grouped list: for each non-empty class group, a small uppercase group label (reuse the `MappingSection` title styling) then the group's `AccountMappingRowForm` rows seeded from `mappedById`. Do NOT wrap this in a fixed-height scroll container.

6. Focus/highlight: keep a `rowRefs = useRef(new Map<string, HTMLDivElement>())`. On mount / when `focusAccountIds` changes, if any focus id is not in the needs-attention list, `setShowAll(true)`; then in a `useEffect`, scroll the first matching ref into view (`el.scrollIntoView({ block: "center" })`) and set a transient `highlightedId` state cleared after ~2s. Pass `highlighted={highlightedId === account.id}` and the `rowRef` callback to the relevant `AccountMappingRowForm`s (needs-attention and all-accounts rows).

7. Update the intro copy `<p>` (lines 115–120) to reflect the widened scope, e.g. "Map any Carbon account to the provider's chart of accounts. Accounts that automated postings run through are marked Required; the rest are optional." Keep it a `<Trans>`.

**If** `Input` is not exported from `@carbon/react`, STOP and grep `packages/react/src/` for the search-input component actually in use (e.g. an `Input`/`InputGroup`), and use that — do not hand-roll an unstyled `<input>`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no TS errors across the route + component.
```
```bash
pnpm run lint
# Expected: no new Biome errors in AccountMapping.tsx / integrations.$id.tsx.
```

**Out of scope:** Do not change `MatchByCodeDrawer` or `AiSuggestModal` mechanics (intents, JSON hidden-field shipping, close-on-settle). Do not add pagination or a nested scroll region. Do not import `@carbon/ee/accounting` types into this component (keep the local structural mirrors — the TS2589 avoidance is deliberate).

---

## Task 5: UI — "Map accounts" deep-link from parked `UNMAPPED_ACCOUNTS` rows

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/settings/ui/Integrations/SyncActivity.tsx`
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Integrations/PostingSyncSettings.tsx:208–213` — the existing `<a href="?tab=account-mapping">Map accounts</a>` deep-link that flips the drawer tab via the `?tab=` param

**Context (verified):**
- The drawer tab is controlled by the `?tab=` search param (`IntegrationForm.tsx:592–599`; route reads it at `integrations.$id.tsx:1751–1754`). The Account Mapping tab value is `"account-mapping"`.
- The operation row type carries `errorCode` and `metadata: Record<string, unknown> | null`. `errorCode` + `metadata` are already rendered in the `SyncOperationDetailDrawer` (lines ~895–918: destructive `Badge` for `errorCode`, raw JSON `<pre>` for `metadata`). The row itself shows only the generic `errorMessage`.
- `Task 4` reads `searchParams.getAll("focusAccount")`, so the link must emit repeated `focusAccount` params.

**Steps:**

1. In `SyncOperationDetailDrawer`, where `operation.errorCode` is rendered (~895–918), when `operation.errorCode === "UNMAPPED_ACCOUNTS"`, read the ids:
   ```tsx
   const unmappedAccountIds = Array.isArray(
     (operation.metadata as { unmappedAccountIds?: unknown } | null)?.unmappedAccountIds
   )
     ? ((operation.metadata as { unmappedAccountIds: unknown[] }).unmappedAccountIds.filter(
         (id): id is string => typeof id === "string" && id.length > 0
       ))
     : [];
   ```
   Then render a link built from a `URLSearchParams` seeded with `tab=account-mapping` and one `focusAccount` per id:
   ```tsx
   {operation.errorCode === "UNMAPPED_ACCOUNTS" && (() => {
     const params = new URLSearchParams();
     params.set("tab", "account-mapping");
     for (const id of unmappedAccountIds) params.append("focusAccount", id);
     return (
       <a
         className="text-primary underline-offset-2 hover:underline"
         href={`?${params.toString()}`}
       >
         <Trans>Map accounts</Trans>
       </a>
     );
   })()}
   ```
   (`Trans` from `@lingui/react/macro` is already imported in this file; if not, add it.)

2. Leave the row-level rendering as-is (the detail drawer is the right home for this action; the row already opens the drawer).

**If** the detail-drawer JSX is structured so a bare `<a>` cannot be inserted next to the `errorCode` Badge without breaking layout, place the link on its own line directly beneath the `errorMessage` block instead — keep it inside the same drawer body.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no TS errors.
```

**Out of scope:** Do not change the sync-activity loader, pagination, filters, or the reconciliation/tie-out banners. Do not surface `errorCode` in the row table (keep the change confined to the detail drawer).

---

## Task 6: Browser verification via `/test`

**Depends on:** Tasks 3, 4, 5
**Files:** none (verification only)

**Preconditions:** local stack up (`crbn up`), an accounting integration connected (Xero/QBO/Rillet) in the local "Carbon Development" company, and accounting enabled (`/x/settings/accounting`). If no provider can be connected locally, STOP and report — the tab renders but the provider `chart` will be empty, which cannot prove the mapping flow end to end.

**Steps (drive with `/test`):**
1. Open `/x/settings/integrations/<accountingIntegrationId>?tab=account-mapping`. Confirm three regions render: **Needs attention**, **Mapped accounts**, and the **All accounts** search + "Show all accounts" toggle. No console errors; no nested inner scrollbar.
2. Click "Show all accounts" (or type in the search box). Confirm the full chart lists, grouped by class (Asset/Liability/Equity/Revenue/Expense/Other), and that typing an account number or name filters it.
3. Pick a non-posting-default **Expense** account, map it to a provider account, Save. Confirm a success flash and that it now appears under **Mapped**.
4. Reproduce the blocking case: create a PO with a `"G/L Account"` line charging an **unmapped** Expense account, post its purchase invoice so the journal syncs and parks (`Warning` / `UNMAPPED_ACCOUNTS`). In the **Sync Activity** tab, open that operation's detail drawer and confirm the **"Map accounts"** link is present.
5. Click "Map accounts". Confirm the drawer switches to the Account Mapping tab and the offending account is scrolled into view and briefly highlighted under **Needs attention → Blocking sync**.
6. Map that account and re-drive the sync (manual retry or the reconciliation sweep). Confirm the operation leaves `Warning`.
7. Confirm the **Required** badge shows on posting-default accounts and that leaving an optional account unmapped does not flag the integration as incomplete.

**Verify:** `/test` playbook passes all steps with screenshots; cache the playbook to `.ai/playbooks/`.

**Out of scope:** Load/perf testing of very large charts (thousands of accounts) — server-side pagination is an explicit follow-up per the spec, not part of this plan.

---

## Post-implementation

- Update `.claude/rules/accounting-sync-handlers.md` (the account-mapping scope / `externalIntegrationMapping` section) to record that the Account Mapping tab now spans the full chart of accounts, with the accountDefault set as the "required" baseline and parked `UNMAPPED_ACCOUNTS` accounts surfaced as "Blocking sync".
- Move the spec to `.ai/specs/implemented/` and add a "Tracking spec:" line to the PR (per `.ai/specs/AGENTS.md`).
- PR includes agent-browser screenshots of the three regions and the deep-link flow (net-new user-facing UI).
