# Opening Balances tool — implementation plan

**Spec:** none — design confirmed with user in-conversation (2026-09-01); captured here.
**Run record:** .ai/runs/2026-09-01-opening-balances.md
**Branch:** mbabane

## Design summary

> **Implementation note (superseded entry point):** the standalone
> `/x/accounting/opening-balances` screen below was the original design. It was
> replaced during implementation by an **inline mode on the Chart of Accounts
> page** — the `charts.tsx` loader/action, a toolbar button that toggles
> `openingBalanceMode` in `ChartOfAccountsTree`, and `OpeningBalancePostModal`
> for the as-of date. The authoritative route/action/guard contract is the one
> described in `apps/erp/app/modules/accounting/AGENTS.md`. The service layer
> (`createOpeningBalanceJournal` / `getExistingOpeningBalanceEntry`) is unchanged
> from this plan; only the UI entry point moved.

New screen at **Accounting → General Ledger → Opening Balances**
(`/x/accounting/opening-balances`). The user sets the initial GL balance for each
posting (leaf) account as of a cutover posting date. On save, the tool posts **one
balanced journal entry** with a new `journalEntrySourceType` value `'Opening
Balance'`, auto-plugging the net difference to the company's **Retained Earnings**
default account so total debits = total credits.

Reuses the existing posting stack — no new edge function:
`getNextSequence("journalEntry")` → `createJournalEntry({ sourceType: 'Opening
Balance' })` → `saveJournalEntryWithLines({ lines })` → `postJournalEntry`.
`saveJournalEntryWithLines` already looks up each account's `class` and encodes the
stored amount via `toStoredAmount(debit, credit, class)`; `postJournalEntry`
already validates debit=credit and resolves the accounting period via
`getOrCreateAccountingPeriod`. So the service layer only has to compute the
Retained-Earnings plug and drive those three calls.

**Guard:** if a *posted, not-yet-reversed* `'Opening Balance'` entry already
exists for the company, the screen shows a banner linking to it and refuses a new
one (opening balances are entered once; changing them means reversing the existing
entry first). The form is pre-filled from that entry when it exists so the user can
see what was entered.

**Currency:** base currency only (matches the journal editor).

## Progress
- [x] Task 1: Migration — add `'Opening Balance'` to `journalEntrySourceType` (20260901165008; enum verified in DB)
- [x] Task 2: Regenerate DB types (2 hits in types.ts)
- [x] Task 3: Models — source-type array + `openingBalanceValidator`
- [x] Task 4: Service — `createOpeningBalanceJournal` + `getExistingOpeningBalanceEntry`
- [x] Task 5: `path.ts` + nav entry (LuWallet under General Ledger)
- [x] Task 6: Route loader/action `opening-balances.tsx`
- [x] Task 7: UI `OpeningBalancesForm.tsx` (+ ui barrel index)
- [x] Task 8: i18n extract + scoped typecheck (erp+ee) + lint — all green
- [ ] Task 9: Browser verification via /test (runs after /ui polish)

## Forced change (not in original task list)
- `packages/ee/src/accounting/core/models.ts` POSTING_POLICY is an exhaustive
  `Record<journalEntrySourceType, ...>`; adding the enum value forced an entry.
  Added `'Opening Balance'` mirroring `Manual` (`syncable: false`) — opening
  balances are a setup artifact the external ledger owns; syncing would
  double-count. Correct + type-forced, so applied in place.

## Dependencies
- Task 2 needs Task 1. Task 3 needs Task 2 (generated enum type). Task 4 needs Task 3.
  Task 6 needs Tasks 4–5. Task 7 needs Task 6. Tasks 5 is independent of 3–4 (can run
  alongside). Task 8 after 3–7. Task 9 last.

---

## Task 1: Migration — add `'Opening Balance'` to `journalEntrySourceType`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_opening-balance-source-type.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260726013204_add_nonconformance_journal_doctypes.sql`

**Steps:**
1. Create the file with `pnpm db:migrate:new opening-balance-source-type` (it
   picks the timestamp — do NOT hand-write it, never `000000` HHMMSS).
2. Body — a single idempotent enum addition:
   ```sql
   -- Opening Balances tool posts a manual-style GL entry tagged with this source
   -- type. ADD VALUE only; no column/usage change. Idempotent for the retrying
   -- deploy runner. Postgres disallows ALTER TYPE ... ADD VALUE inside a txn with
   -- later use of the value, but this migration only adds it, so it is fine.
   ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Opening Balance';
   ```
3. Apply it: `pnpm db:migrate`.

**Verify:**
```bash
grep -c "ADD VALUE IF NOT EXISTS 'Opening Balance'" packages/database/supabase/migrations/*_opening-balance-source-type.sql
# Expected: 1 (match the exact ALTER TYPE statement — a bare "Opening Balance"
# substring also matches the descriptive comment and would report 2).
```
Also confirm the enum applied:
```bash
# after pnpm db:migrate — no error output means success
echo "migration applied"
```

**Out of scope:** Do not touch the base enum definition in
`20260402000000_journal-entries.sql` (never edit an applied migration). Do not add
any new table or column.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts` (and any re-exported enum types)

**Steps:**
1. Run `pnpm run generate:types`. This must run against the migrated local DB, so
   `pnpm db:migrate` (Task 1 step 3) must have succeeded first.
2. Do not hand-edit the output.

**Verify:**
```bash
grep -c "Opening Balance" packages/database/src/types.ts
# Expected: >= 1 (the enum union now includes it)
```
If the count is 0, STOP — the migration didn't apply to the DB the generator reads.

**Out of scope:** manual edits to generated types.

---

## Task 3: Models — source-type array + `openingBalanceValidator`

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — add enum-array value + new validator
- Copy from (precedent): the existing `journalEntryValidator` (same file, ~line 330 region) and `journalEntrySourceTypes` array (~line 681)

**Steps:**
1. In the `journalEntrySourceTypes` array (starts ~line 681), add `"Opening
   Balance"` as a new entry. Place it after `"Manual"` (keep it near the top; the
   array is not alphabetized). This array is the UI-facing source-type list.
2. Add a new validator near the other journal validators:
   ```typescript
   export const openingBalanceValidator = z.object({
     postingDate: z.string().min(1, { message: "Posting date is required" }),
     // JSON-encoded array of { accountId, amount } produced by the form's hidden
     // input. amount is the signed base-currency figure the user typed against the
     // account, positive = the account's natural balance side (debit for
     // Asset/Expense, credit for Liability/Equity/Revenue). The service converts
     // amount → {debit, credit} per class before posting.
     lines: z
       .string()
       .min(1, { message: "At least one balance is required" })
       .transform((val, ctx) => {
         try {
           const parsed = JSON.parse(val) as Array<{
             accountId: string;
             amount: number;
           }>;
           return parsed.filter(
             (l) => l.accountId && typeof l.amount === "number" && l.amount !== 0
           );
         } catch {
           ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid lines" });
           return z.NEVER;
         }
       })
   });
   ```
   Note: the form sends one signed `amount` per account (natural-balance sign), NOT
   separate debit/credit columns — the debit/credit split is derived from account
   class in the service. Zero-amount rows are dropped.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp 2>&1 | tail -20
# Expected: no type errors referencing accounting.models.ts
```

**Out of scope:** do not change `journalEntryValidator`.

---

## Task 4: Service — `createOpeningBalanceJournal` + `getExistingOpeningBalanceEntry`

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.ee.service.ts` — two new exported functions
- Copy from (precedent): `createJournalEntry` (~4795), `saveJournalEntryWithLines`
  (~4904), `postJournalEntry` (~5015), `getDefaultAccounts` (~3538) in the same file

**Steps:**
1. Confirm imports already present at top of file: `getNextSequence` (from
   `~/modules/settings`, already imported ~line 20), `toStoredAmount`,
   `toDisplayDebit`, `toDisplayCredit` (from `@carbon/utils`). Add whichever of the
   `toDisplay*` are missing to the existing `@carbon/utils` import.
2. Add `getExistingOpeningBalanceEntry`:
   ```typescript
   // Returns the company's current posted Opening Balance journal entry (with its
   // lines decoded to per-account debit/credit) or null. "Reversed" entries do NOT
   // count — after a reversal the user may enter a fresh set. Only status='Posted'
   // with sourceType='Opening Balance' blocks a new one.
   export async function getExistingOpeningBalanceEntry(
     client: SupabaseClient<Database>,
     companyId: string
   ) {
     const entry = await client
       .from("journal")
       .select(
         "id, journalEntryId, postingDate, status, journalLine(accountId, amount, account(id, class, number, name))"
       )
       .eq("companyId", companyId)
       .eq("sourceType", "Opening Balance")
       .eq("status", "Posted")
       .order("createdAt", { ascending: false })
       .limit(1)
       .maybeSingle();

     if (entry.error) return { data: null, error: entry.error };
     if (!entry.data) return { data: null, error: null };

     const lines = (entry.data.journalLine ?? [])
       .filter((l) => l.account) // skip the retained-earnings plug? no — keep all
       .map((l) => {
         const cls = (l.account as { class: AccountClass }).class;
         return {
           accountId: l.accountId as string,
           debit: toDisplayDebit(l.amount as number, cls),
           credit: toDisplayCredit(l.amount as number, cls)
         };
       });

     return {
       data: {
         id: entry.data.id,
         journalEntryId: entry.data.journalEntryId,
         postingDate: entry.data.postingDate,
         lines
       },
       error: null
     };
   }
   ```
   Use the `AccountClass` type already used in the file (or
   `Database["public"]["Enums"]["glAccountClass"]`). If the embed shape fights the
   generated types, cast the row locally rather than changing the query shape.
3. Add `createOpeningBalanceJournal`:
   ```typescript
   export async function createOpeningBalanceJournal(
     client: SupabaseClient<Database>,
     args: {
       companyId: string;
       companyGroupId: string;
       userId: string;
       postingDate: string;
       // one signed natural-balance amount per account (from the form)
       balances: Array<{ accountId: string; amount: number }>;
     }
   ) {
     const { companyId, companyGroupId, userId, postingDate, balances } = args;

     const entered = balances.filter((b) => b.amount !== 0);
     if (entered.length === 0) {
       return { data: null, error: { message: "No opening balances entered" } };
     }

     // Resolve Retained Earnings (the balancing plug).
     const defaults = await getDefaultAccounts(client, companyId);
     if (defaults.error) return { data: null, error: defaults.error };
     const retainedEarningsAccount = defaults.data?.retainedEarningsAccount;
     if (!retainedEarningsAccount) {
       return {
         data: null,
         error: {
           message:
             "No Retained Earnings account is configured in Default Accounts"
         }
       };
     }

     // Look up account classes so we can split the natural-balance amount into
     // debit/credit. (saveJournalEntryWithLines re-derives the stored amount from
     // debit/credit, so we must hand it debit/credit, not the signed amount.)
     const accountIds = [...new Set(entered.map((b) => b.accountId))];
     const accounts = await client
       .from("account")
       .select("id, class")
       .in("id", accountIds);
     if (accounts.error) return { data: null, error: accounts.error };
     const classById = new Map(
       accounts.data.map((a) => [a.id, a.class as AccountClass])
     );

     // Build debit/credit lines. A positive natural-balance amount posts to the
     // account's natural side: debit for Asset/Expense, credit for
     // Liability/Equity/Revenue. Negative flips it.
     const naturalDebit = (cls: AccountClass) =>
       cls === "Asset" || cls === "Expense";
     let netDebitMinusCredit = 0; // in signed "debit positive" space
     const lines: Array<{ accountId: string; debit: number; credit: number }> = [];
     for (const b of entered) {
       const cls = classById.get(b.accountId);
       if (!cls) {
         return {
           data: null,
           error: { message: `Account not found: ${b.accountId}` }
         };
       }
       const isDebit = naturalDebit(cls) ? b.amount >= 0 : b.amount < 0;
       const magnitude = Math.abs(b.amount);
       const debit = isDebit ? magnitude : 0;
       const credit = isDebit ? 0 : magnitude;
       netDebitMinusCredit += debit - credit;
       lines.push({ accountId: b.accountId, debit, credit });
     }

     // Balancing plug to Retained Earnings. If entered lines net to more debit,
     // the plug is a credit, and vice-versa. Use equals() tolerance so a zero plug
     // is dropped.
     if (!equals(netDebitMinusCredit, 0)) {
       const plug = netDebitMinusCredit; // debit-positive
       lines.push({
         accountId: retainedEarningsAccount,
         debit: plug < 0 ? -plug : 0,
         credit: plug > 0 ? plug : 0
       });
     }

     // Allocate readable id + create the Draft header with the new source type.
     const journalEntryId = await getNextSequence(client, "journalEntry", companyId);
     if (journalEntryId.error || !journalEntryId.data) {
       return {
         data: null,
         error: journalEntryId.error ?? { message: "Failed to allocate sequence" }
       };
     }

     const created = await createJournalEntry(client, {
       journalEntryId: journalEntryId.data as string,
       sourceType: "Opening Balance",
       companyId,
       createdBy: userId,
       postingDate,
       description: "Opening balances"
     });
     if (created.error || !created.data) {
       return { data: null, error: created.error ?? { message: "Create failed" } };
     }
     const id = created.data.id;

     const saved = await saveJournalEntryWithLines(client, {
       journalEntryId: id,
       postingDate,
       description: "Opening balances",
       updatedBy: userId,
       lines,
       companyId,
       companyGroupId
     });
     if (saved.error) return { data: null, error: saved.error };

     const posted = await postJournalEntry(client, id, userId);
     if (posted.error) return { data: null, error: posted.error };

     return { data: { id }, error: null };
   }
   ```
4. Import `equals` from `@carbon/utils` if not already imported (it's the float
   tolerance helper from precision). If `equals` is not exported there, use
   `Math.abs(netDebitMinusCredit) > EPSILON` with `EPSILON` from `@carbon/utils`,
   or a local `1e-6`. Prefer the shared helper — check the import first.
   If neither `equals` nor `EPSILON` is exported from `@carbon/utils`, STOP and
   report rather than inventing a literal (numeric-precision rule bans stray
   scale/tolerance literals).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp 2>&1 | tail -20
# Expected: no type errors in accounting.ee.service.ts
```

**Out of scope:** do not modify `createJournalEntry`, `saveJournalEntryWithLines`,
or `postJournalEntry`. Do not add a Kysely client (service files are browser-bundled
— use only the passed `client`).

---

## Task 5: `path.ts` + nav entry

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add `accountingOpeningBalances`
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — nav item
- Copy from (precedent): the `accountingJournals` path entry (~line 28) and the
  "Journal Entries" nav route (~line 60)

**Steps:**
1. In `path.ts`, next to `accountingJournals: \`${x}/accounting/journals\`,` add:
   ```typescript
   accountingOpeningBalances: `${x}/accounting/opening-balances`,
   ```
2. In `useAccountingSubmodules.tsx`, add a route object inside the **General
   Ledger** group's `routes` array (after "Journal Entries"):
   ```tsx
   {
     name: t`Opening Balances`,
     to: path.to.accountingOpeningBalances,
     role: "employee",
     icon: <LuWallet />
   }
   ```
   Add `LuWallet` to the `react-icons/lu` import at the top of the file (keep the
   import list alphabetized as it currently is).

**Verify:**
```bash
grep -n "accountingOpeningBalances" apps/erp/app/utils/path.ts
grep -n "Opening Balances" apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx
# Expected: one hit each
```

**Out of scope:** do not reorder other nav groups.

---

## Task 6: Route loader/action `opening-balances.tsx`

**Depends on:** Tasks 4, 5
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/opening-balances.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/journals.new.tsx`
  (action shape, service-role invoke pattern) and any accounting list route with a
  loader that reads `getChartOfAccounts` (e.g. `charts.tsx`) for the loader shape,
  and `payment-terms.$paymentTermId.tsx` for the validate→service→flash pattern

**Steps:**
1. **Loader** — `requirePermissions(request, { view: "accounting" })` →
   `{ client, companyId, companyGroupId }`. Also read the base currency
   (`getCompany`/user company base currency — use the same source the journal editor
   uses: `useUser().company.baseCurrencyCode` is client-side; for the loader, read
   the company's `baseCurrencyCode` however neighboring accounting loaders do — if
   unclear, pass nothing and let the form read `useUser()`).
   - `getChartOfAccounts(client, companyGroupId, { incomeBalance: null, startDate:
     null, endDate: null })`, then filter to **posting leaf accounts**: `a.isGroup
     === false && a.class` present. Sort by `number`.
   - `getExistingOpeningBalanceEntry(client, companyId)`.
   - Return a plain object `{ accounts, existingEntry }` (NO `Response.json` /
     `json()` — return the object directly).
2. **Action** — `assertIsPost(request)`; `requirePermissions(request, { create:
   "accounting" })` → `{ client, companyId, companyGroupId, userId }`.
   - `validator(openingBalanceValidator).validate(formData)`; on error
     `return validationError(validation.error)`.
   - Re-check the guard server-side: `getExistingOpeningBalanceEntry`; if one
     exists, `return data({}, await flash(request, error(null, "An opening balance
     entry already exists — reverse it before entering new balances")))`.
   - Map validated `lines` (`{accountId, amount}[]`) →
     `createOpeningBalanceJournal(client, { companyId, companyGroupId, userId,
     postingDate, balances: lines })`.
   - On error → `return data({}, await flash(request, error(result.error, "Failed
     to post opening balances")))`.
   - On success → `throw redirect(path.to.journalEntry(result.data.id), await
     flash(request, success("Opening balances posted")))`.
3. **Default export** — render `<OpeningBalancesForm accounts={accounts}
   existingEntry={existingEntry} />` from loader data via `useLoaderData`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp 2>&1 | tail -20
# Expected: no type errors in opening-balances.tsx
```
If the base-currency source in the loader is unclear after checking neighbors,
default to reading it in the form via `useUser().company.baseCurrencyCode` and pass
nothing from the loader — do NOT guess a service function name.

**Out of scope:** no `clientAction` (this posts a JE, it is not a cached list
entity). No CSV export.

---

## Task 7: UI `OpeningBalancesForm.tsx`

**Depends on:** Task 6
**Files:**
- Create: `apps/erp/app/modules/accounting/ui/OpeningBalances/OpeningBalancesForm.tsx`
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryForm.tsx`
  (Card + ValidatedForm + line-table + totals footer + hidden JSON `lines` field)

**Steps:**
1. Props:
   ```typescript
   type OpeningBalancesFormProps = {
     accounts: Array<{
       id: string;
       number: string | null;
       name: string;
       class: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
     }>;
     existingEntry: {
       id: string;
       journalEntryId: string;
       postingDate: string;
       lines: Array<{ accountId: string; debit: number; credit: number }>;
     } | null;
   };
   ```
2. If `existingEntry` is non-null, render an informational banner (use
   `@carbon/react` `Alert`/`Status` or the Card empty-state pattern) that says an
   opening-balance entry already exists, with a `<Link to={path.to.journalEntry(
   existingEntry.id)}>` button showing `existingEntry.journalEntryId`, and text:
   "Reverse it from the journal entry screen before entering new balances." Show the
   entered balances read-only underneath (map `existingEntry.lines` to account
   names). Do NOT render the editable form in this state.
3. Otherwise render the editable form:
   - `ValidatedForm method="post" validator={openingBalanceValidator}`.
   - `DatePicker name="postingDate"` — default via `useCompanyToday()` from
     `~/hooks` (business date; never `new Date()`).
   - A table: one row per account showing `number` + `name` (stacked, like the
     journal line account cell) and a single amount `Number` input in state. Header
     columns: "Account", "Amount" (right-aligned). Keep amounts in a
     `Record<accountId, number>` state map.
   - Use `Number`/`NumberControlled` from `~/components/Form` with
     `formatOptions={INPUT_FORMAT.money(baseCurrencyCode, decimalPlaces)}` — read
     `baseCurrencyCode` from `useUser().company.baseCurrencyCode` and decimals from
     the currency (use `useCurrencyFormatter`/`useCurrencyMinDecimals` as the
     journal editor does). Do NOT pass inline `minimumFractionDigits`.
   - Hidden field: `<input type="hidden" name="lines" value={linesJson} />` where
     `linesJson = JSON.stringify(Object.entries(amounts).filter(([,v]) => v).map(
     ([accountId, amount]) => ({ accountId, amount })))`.
   - Footer: compute per-account debit/credit exactly as the service does
     (natural-debit = Asset/Expense) to show live **Total Debits**, **Total
     Credits**, and **"Balancing to Retained Earnings: {formatted plug}"** (the
     signed difference). Format money via `useCurrencyFormatter`.
   - A single **Post Opening Balances** submit button, disabled unless
     `permissions.can("create", "accounting")` and at least one non-zero amount.
   - All user-visible strings use `useLingui().t\`\`` or `<Trans>`.
4. Export from the module barrel if the module `index.ts` re-exports `ui/*`
   (check `apps/erp/app/modules/accounting/index.ts`; if it barrels UI, add the
   export — otherwise import directly in the route).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp 2>&1 | tail -20
# Expected: no type errors in OpeningBalancesForm.tsx
```

**Out of scope:** no per-account debit/credit two-column entry (single amount
column only). No dimension pickers. This first pass is functional; the /ui phase
handles visual polish (Vercel aesthetic).

---

## Task 8: i18n extract + scoped typecheck + lint

**Depends on:** Tasks 3–7
**Files:**
- Modify (generated `.po`): `packages/locale/locales/*/erp.po`

**Steps:**
1. `pnpm lingui:extract` to register the new `<Trans>` / `t\`\`` strings.
2. Scoped typecheck and lint.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp 2>&1 | tail -20
pnpm run lint 2>&1 | tail -20
# Expected: both clean (no errors in the new files)
```

**Out of scope:** do not run whole-repo `tsc` (OOMs). Do not translate other
locales here (the /translate step can fill them later if desired).

---

## Task 9: Browser verification via /test

**Depends on:** Tasks 1–8 (+ the /ui polish phase, which runs before this)
**Files:** none (verification only)

**Steps:**
1. Boot the stack (`crbn up`), `/auth` to log in.
2. Enable accounting locally if needed (`/x/settings/accounting`), and confirm a
   Retained Earnings default is set (`/x/accounting/defaults`).
3. Navigate to Accounting → General Ledger → **Opening Balances**.
4. Enter a debit balance on a Cash/Asset account and confirm the footer shows the
   plug flowing to Retained Earnings and the entry balancing.
5. Post; confirm redirect to the created journal entry, source type **Opening
   Balance**, status **Posted**, debits = credits.
6. Return to Opening Balances; confirm the guard banner now appears linking to that
   entry. Reverse the entry from the JE screen; confirm the form is editable again.

**Verify:** the pass/fail table from `/test`; every step above passes.

**Out of scope:** load testing, multi-company consolidation.
