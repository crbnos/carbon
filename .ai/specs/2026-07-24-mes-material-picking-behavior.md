# Spec: MES material-picking behavior — pre-select setting + incomplete picking-list policy

- **Date:** 2026-07-24
- **Author:** Sid
- **Source:** Slack thread 2026-07-23 (Brad Barbin / Sid / Davide Codemo — "Zero")
- **Status:** Design complete, Part 1 + Part 2 implemented (blocked on `pnpm db:migrate` + `pnpm run generate:types`)
- **Apps touched:** `apps/mes`, `apps/erp`, `packages/database`

Two independently-shippable changes in the MES shop-floor material/picking area:

- **Part 1** — gate the no-picking-list FEFO pre-selection behind a company setting (default OFF).
- **Part 2** — stop silent completion of a picking list with unpicked material: a configurable
  **warn/error** policy plus a new **Partial** header status.

They share a theme (picking correctness on the shop floor) but are separate features and can
ship as two PRs.

---

## Background / problem

### Part 1 — the pre-selection was ungated

On the MES `IssueMaterialModal` (`apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx`),
opening the issue dialog for any batch/serial-tracked material with on-hand stock at the location
**pre-fills** a FEFO lot and yanks the operator off the **Scan** tab onto **Select** — regardless of
whether a picking list ever picked anything. The FEFO suggestion seeds the rows (`seedAllocation`,
~L355) and flips the tab (~L376/387). It's skipped only when there's nothing to suggest (no on-hand)
or the operator already typed/selected.

Slack decision: **default tab = Scan; pre-select only when there's a real picking list.** Zero still
wants the no-picking-list FEFO pre-selection for their workflow, so it becomes an **opt-in company
setting**, default OFF. "A suggestion is different from a preselection" — the Select-tab FEFO option
ordering still shows always; only the auto-fill + tab-flip becomes gated.

Two-farm rationale (Davide):
- **Small farm** — same person picks and uses material, no picking list. Wants the correct batch
  auto-suggested (expires-first / arrived-first) to avoid grabbing the wrong one → **setting ON**.
- **Big farm** — a picker scans qrcodes into a picking list; a second operator just checks the picked
  lot → **setting OFF / default** (Scan-first).
- The pre-fill is **never a commit** — it's a suggestion until the operator presses **Issue**, and they
  can change the batch in the Select section first. So gating it only decides which tab they land on.
- "auto-select respects auto-suggest" is already true in code: the seed comes from
  `suggestedAllocation`, which is FEFO/pick-order ordered (`getPickMethod` → `sortLotsByPickMethod`).

### Part 2 — a short-picked list completes silently

An operator who can't find material can press **Finish** and the list flips to `Completed` with lines
still unpicked. The completion path does **zero** quantity validation:

- **Finish button** — `apps/mes/app/routes/x+/picking.$pickingListId.tsx` `PickingListControls`
  (L167-221), `onClick={() => setStatus("Completed")}` (L207-218), always enabled.
- **Status action** — `apps/mes/app/routes/x+/picking.$pickingListId.status.tsx` (L11-58): validates the
  status is a member of the enum, blocks MES from unlocking a locked list, then calls the service. No
  quantity check.
- **Service** — `updatePickingListStatus` (`apps/mes/app/services/picking.service.ts:79-95`): plain
  header UPDATE.

The DB trigger `update_picking_list_status()` (`20260616134752_picking-list-short-blocks-completion.sql`)
only governs **automatic** header status — it keeps the list `In Progress` while short/under-picked lines
are outstanding — but the explicit Finish button bypasses it.

There is **no `Partial` header status** today; the only shortage signal is line-level `Short`.

Slack decision (Davide + Sid): finishing with unfound material must not silently complete — make it
**warn or error, configurable "like the item-rule (storage-rule) violation setting"**, and **flag the
list Partial** (persisted header status, confirmed by Sid).

---

## Grounded current-state facts

### Enums (`packages/database/supabase/migrations/20260601143527_picking-lists.sql`)
- `pickingListStatus`: `Draft | In Progress | Completed | Cancelled`.
- `pickingListLineStatus`: `Pending | Picked | Short | Cancelled`.

### `pickingListLine` quantity columns
- `quantityToPick NUMERIC NOT NULL`, `quantityPicked NUMERIC NOT NULL DEFAULT 0`,
  `outstandingQuantity` GENERATED (`toPick - picked`, floored at 0), `status` default `Pending`.

### TS mirrors of the status enum (BOTH must gain `Partial`)
- MES: `apps/mes/app/services/models.ts:44` `pickingListStatus = [...]`.
- ERP: `apps/erp/app/modules/inventory/inventory.models.ts` `pickingListStatusType`.
- `isPickingListLocked` (MES `models.ts:66-70`): `status === "Completed" || "Cancelled"`.

### Status badge
- ERP `apps/erp/app/modules/inventory/ui/PickingLists/PickingListStatus.tsx` — a `switch(status)` →
  `Badge`. Draft=secondary, In Progress=blue, Completed=green, Cancelled=destructive.

### Policy-setting precedents
- **`expiredEntityPolicy`** (`Warn | Block | BlockWithOverride`) — company-wide, stored in the
  `companySettings.inventoryShelfLife` JSONB, configured on `settings/inventory.tsx` with a
  `ChoiceSelect`, enforced server-side (`issue` edge fn) + a modal override textarea.
- **Storage-rule `severity`** (`error | warn`) — per-rule column, configured with `ChoiceCardGroup`
  (`storage-rules/ui/SeveritySelect.tsx`), enforced by `isBlocked`
  (`packages/ee/src/storage-rules/server.ts:55-64`: `error` = hard block; `warn` = block-until-acknowledged)
  + `StorageRuleViolationModal` (`packages/ee/src/storage-rules/violation-modal.tsx`: confirm button
  disabled on any error; "Acknowledge & continue" when only warnings).

### MES reads company settings
- `getCompanySettings` (`apps/mes/app/services/inventory.service.ts:82`) `select("*")`, so a new
  `companySettings` column is available without changing the service.

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Part 1 setting = `companySettings.autoSelectMaterialWithoutPickingList` BOOLEAN, default **FALSE** | Brad: default Scan, pre-select only for picking lists. Small-farm turns it on. |
| D2 | Part 1 gates **both** batch + serial no-picking-list seed | Whole fallback, one consistent rule. |
| D3 | Part 1 home = **Production** settings page | Shop-floor behavior toggle. |
| D4 | Part 2 policy = `companySettings.incompletePickingListPolicy` `warn \| error`, default **warn** | Mirrors storage-rule severity; warn surfaces without hard-blocking. |
| D5 | Part 2 policy home = **Inventory** settings page, `ChoiceCardGroup` | Sits next to `expiredEntityPolicy`; same 2-value shape as `SeveritySelect`. |
| D6 | Add **`Partial`** to `pickingListStatus` enum (persisted header state, filterable) | Sid confirmed. |
| D7 | Enforcement is **server-side** in the status action; client only surfaces the response | Never trust the client for a data-integrity gate. |
| D8 | `Partial` is a **locked** terminal state (ERP-reopen-only, like Completed) | It's a completion outcome; MES must not silently reopen it. |

---

## Part 1 — Pre-select setting (IMPLEMENTED)

### Behavior
`IssueMaterialModal` `seedAllocation` today: `picked.length ? picked : suggested`. New:
- Picked lots (real picking list) → **always** seed + flip to Select (unchanged).
- FEFO suggestion → seeds **only if** `autoSelectMaterialWithoutPickingList` is on.
- Unchanged: Select-tab `batchOptions` FEFO ordering, add-row remainder fill, the
  "operator already typed/selected" guard, the no-on-hand skip, default tab `"scan"`.

When OFF + no picking list → empty seed → the seed effect early-returns → stays on Scan, blank rows.

### Files
1. **Migration** — `packages/database/supabase/migrations/20260724143512_material-preselect-setting.sql`:
   `ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "autoSelectMaterialWithoutPickingList" BOOLEAN NOT NULL DEFAULT FALSE;`
2. **ERP service** — `settings.service.ts` `updateAutoSelectMaterialWithoutPickingListSetting(client, companyId, value)` (exported via barrel).
3. **ERP UI** — `settings/production.tsx`: `autoSelectMaterialWithoutPickingListToggle` intent + a `<Card>`
   with `<Switch>` on a dedicated `toggleFetcher`.
4. **MES loader** — `operation.$operationId.tsx` returns
   `autoSelectMaterialWithoutPickingList: companySettings.data?.autoSelectMaterialWithoutPickingList ?? false`.
5. **MES prop-drill** — `JobOperation.tsx` (`JobOperationProps` + destructure default `false`) → `IssueMaterialModal`.
6. **MES gate** — `IssueMaterialModal.tsx` seed ternary:
   ```ts
   : pickedAllocation.length
     ? pickedAllocation
     : autoSelectMaterialWithoutPickingList
       ? suggestedAllocation
       : [];
   ```

### Status: done. Blocked only on `pnpm db:migrate` + `pnpm run generate:types` (the sole typecheck
errors are the not-yet-generated column). Biome clean.

---

## Part 2 — Incomplete picking-list policy + Partial status (IMPLEMENTED)

Deviations from the design below, decided during implementation:
- **Policy control uses `ChoiceSelect`** (not `ChoiceCardGroup`) on the Inventory
  settings page, to match the neighboring `expiredEntityPolicy` control for on-page
  consistency.
- **Policy stored as a top-level `companySettings.incompletePickingListPolicy` column**
  (mirrors the Part 1 boolean precedent), not a JSONB blob.
- **Client is server-authoritative**: MES `PickingListControls` always submits Finish;
  the status action returns `{ needsAcknowledgement }` (warn) or `{ blocked }` (error)
  and the client only surfaces the response. No policy is threaded to the loader.
- Migrations: `20260728120000_picking-list-partial-status.sql` (isolated `ADD VALUE`),
  `20260728120100_incomplete-picking-list-policy.sql` (policy column + trigger rewrite).


### Definitions
- **Unresolved line:** `status <> 'Cancelled'` AND `status <> 'Short'` AND `quantityPicked < quantityToPick`
  (never picked, or under-picked without acknowledging Short). Same predicate as the trigger's
  outstanding-work test, plus the Short exclusion.
- **Final status on explicit Finish:** every line fully `Picked` (and none `Short`) → `Completed`;
  otherwise (any `Short`, or acknowledged shortfall) → `Partial`.

### Enforcement flow (on Finish → `status = 'Completed'`)
1. Load the list's lines. Compute `unresolved`.
2. If `unresolved.length > 0`:
   - policy `error` → return `{ success: false, blocked: true, unresolvedLines, message }`; **do not** change status. Header stays `In Progress`.
   - policy `warn` and no `acknowledged` flag → return `{ success: false, needsAcknowledgement: true, unresolvedLines }`.
3. Else / `acknowledged` → set final status (`Completed` vs `Partial`) per the rule above, return `{ success: true }`.

Fail closed: if the `getCompanySettings` lookup errors or returns no row, refuse
the finish (`{ success: false, message }`) rather than defaulting to `warn` — a
`warn` default could be `acknowledged`-bypassed past a configured `error` policy.

### Files & changes

**1. Migration A — enum value (own file, isolated)**
```sql
ALTER TYPE "pickingListStatus" ADD VALUE 'Partial';
```
`ALTER TYPE … ADD VALUE` can't share a transaction with statements that use the new value — keep it
alone, ahead of the trigger migration. Regen types after.

**2. Migration B — policy column**
```sql
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "incompletePickingListPolicy" TEXT NOT NULL DEFAULT 'warn'
  CHECK ("incompletePickingListPolicy" IN ('warn','error'));
```

**3. Migration C — trigger update** (`update_picking_list_status()` replacement)
- Keep the outstanding-work test. In the "all resolved" branch: if ≥1 non-Cancelled line is `Short`
  (or picked-short but resolved), set `Partial` instead of `Completed`; fully picked → `Completed`.
- Never stomp a `Cancelled` header. When work remains, a terminal `Completed`/`Partial` header **is**
  moved back to `In Progress` (an unpick must not leave it stuck on a completion state). The explicit
  Finish action is the authority that sets `Completed`/`Partial`; the trigger only keeps the header
  consistent with line state. Every line/header query is scoped by `companyId = NEW."companyId"`.

**4. Enum mirrors + validator**
- MES `apps/mes/app/services/models.ts`: add `"Partial"` to `pickingListStatus`. Decide `isPickingListLocked`
  includes `Partial` (D8 → yes).
- ERP `apps/erp/app/modules/inventory/inventory.models.ts`: add `"Partial"` to `pickingListStatusType`;
  add `incompletePickingListPolicies = ["warn","error"] as const` + validator.

**5. ERP settings service + UI**
- `settings.service.ts`: `updateIncompletePickingListPolicySetting(client, companyId, value)`.
- `settings/inventory.tsx`: add an intent + a `ChoiceCardGroup<"warn"|"error">` block modeled on
  `storage-rules/ui/SeveritySelect.tsx` (Error = "Blocks completion until resolved", Warning = "Allows
  acknowledge & continue"), next to the `expiredEntityPolicy` control.

**6. Status badge**
- `PickingListStatus.tsx`: add a `case "Partial"` → `<Badge variant="orange">` (or `yellow`).
- Add `Partial` to any picking-list status **filter** option lists (table filters / legend).

**7. MES read**
- The policy is read **server-side** in the status action (item 8) via `getCompanySettings` — it is
  **not** threaded through the loader. `PickingListControls` stays policy-agnostic: it always submits
  Finish and only reacts to the action response.

**8. Server enforcement**
- `picking.$pickingListId.status.tsx` action: implement the flow above (fail-closed on a settings-lookup
  error). Return typed results:
  `{ success: true }` /
  `{ success: false, blocked: true, unresolvedLines, message }` (error policy) /
  `{ success: false, needsAcknowledgement: true, unresolvedLines }` (warn, not yet acknowledged) /
  `{ success: false, message }` (settings/line-load failure). Read `acknowledged` from the form.

**9. MES UI — Finish gating + acknowledge modal**
- `PickingListControls`: on `error` → inline/toast error listing unpicked items; on
  `needsAcknowledgement` → open a confirm modal (model on `StorageRuleViolationModal`) listing the items,
  "Acknowledge & continue" resubmits with `acknowledged=true`.

### Edge cases
- **Reopen (ERP) then re-pick:** trigger must not auto-flip a reopened `Draft`/`In Progress` to `Partial`;
  `Partial` is only set by the explicit action or when the trigger's all-resolved branch sees a Short.
- **All lines Cancelled:** no outstanding work, no Short → `Completed` (requirement gone). Acceptable.
- **`warn` + operator cancels the modal:** no status change.
- **Serial vs batch:** policy is line-quantity based, independent of tracking type.

---

## Verification

Both parts (after `pnpm db:migrate` + `pnpm run generate:types`):
- `pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp --filter=mes`
- `pnpm run lint`

**Part 1** — batch material, on-hand at location, no picking list (`/auth` + `/test`):
- Setting OFF (default): open modal → lands on **Scan**, rows blank; Select tab still lists FEFO options.
- Setting ON: open modal → rows pre-filled FEFO, auto-switches to **Select**.
- With a picking list (picked lots), both settings: still pre-selects + flips to Select.
- Serial-tracked: same gating.
- ERP Production settings: toggle persists + reloads.

**Part 2** — picking list with ≥1 unpicked line:
- Policy **error**: Finish → blocked, error names the unpicked item; header stays `In Progress`. Pick or
  Short the line → Finish → `Completed` (picked) / `Partial` (short).
- Policy **warn**: Finish → acknowledge modal lists unpicked items; confirm → `Partial`; cancel → unchanged.
- Fully-picked list → Finish → `Completed` under both policies.
- `Partial` renders in the badge + is filterable.
- ERP Inventory settings: policy choice persists + reloads.

---

## Rollout / sync
- Update `.claude/rules/mes-job-operation-ui.md` (material-picking section): Part 1 gated fallback + Part 2
  warn/error completion policy + `Partial` status.
- Three migrations total: Part 1 column (done); Part 2 enum `ADD VALUE` (isolated); Part 2 column + trigger.
- Never rebuild the DB to test — the user runs `pnpm db:migrate`.
