# Test Plan — Change Orders: Replacement Part, net-new New Part, N→1 consolidation

**Feature:** `.ai/specs/2026-07-19-change-order-new-part-and-consolidation.md`
**Impl plan:** `.ai/plans/2026-07-19-change-order-new-part-and-consolidation.md`
**Branch:** `feat/change-orders-top-to-bottom`
**Type:** manual / e2e verification (basis for a `/test` playbook)

## What changed (under test)

1. The change type formerly called **New Part** is renamed **Replacement Part** (1:1 supersession — new part number that supersedes the affected part).
2. A new **New Part** change type: genuinely net-new part, **no predecessor, no supersession**, minted + released under the CO (Make or Buy).
3. **N→1 consolidation**: introduce a New Part and, on a parent assembly (Version/Revision change), remove the old component lines and add the New Part — a BOM change, not a supersession.
4. The **Add Affected Item** modal now leads with a **change-type Select** that drives the body (existing-part picker vs. create-new-part mini-form).

Taxonomy under test (`changeOrderChangeType`): `Version | Revision | Replacement Part | New Part`.

---

## 0. Environment & setup

**Stack:** local dev running (`crbn up`); ERP at the value of `ERP_URL` in `.env.local` (currently `https://erp.change-orders-top-to-bottom.dev`). Log in via the `DEV_BYPASS_EMAIL` bypass (`test@carbon.ms`). Company: **Carbon Development**.

**DB access (for the verification queries below):**
```bash
DB_URL=$(grep -E "^SUPABASE_DB_URL=" .env.local | cut -d= -f2-)
psql "$DB_URL" -c "<query>"
```

**Migration must be applied** (it is, on this branch's local DB). Confirm:
```sql
SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'changeOrderChangeType';
-- Expect: Version,Revision,Replacement Part,New Part
```

### Test data to create (once)

| Fixture | How | Purpose |
|---|---|---|
| **ASM-A** — a Make (manufactured) part with a BOM of **3 purchased components** C1, C2, C3 | `/x/part/new` (Make) then add 3 BOM lines on its method | The consolidation target |
| **ASM-B** — a second Make part whose BOM **also uses C1** | `/x/part/new` (Make) + add C1 to its BOM | Proves a "removed" component is untouched elsewhere |
| (optional) an **existing CO** with a pre-migration "New Part" affected item | already-seeded rows, if any (`seed-change-orders.ts`) | Rename regression (§A) |

> If no pre-migration CO exists locally, §A3 is covered by §F (create a Replacement Part CO fresh and confirm it supersedes).

---

## A. Rename / migration regression — "Replacement Part"

| ID | Steps | Expected |
|---|---|---|
| A1 | Query existing affected items | Any row that was `New Part` before the migration now reads `Replacement Part`. `SELECT DISTINCT "changeType" FROM "changeOrderAffectedItem";` → only values from the 4-type set; **no bare `New Part` row that has a `baseMakeMethodId`** (those are replacements). |
| A2 | Enum check (§0) | `Version,Revision,Replacement Part,New Part` |
| A3 | Open any pre-existing CO that had a "New Part" affected item | The affected-item badge shows **Replacement**; the cutover/Part Supersession card is present; releasing it still writes an `itemSupersession` (see F2). |

---

## B. Add Affected Item modal — change-type Select

Open a CO (Draft), click **Add Affected Item**.

| ID | Steps | Expected |
|---|---|---|
| B1 | Observe the modal | First control is a **Change type** Select with options: Version, Revision, Replacement Part, New Part. Default **Version**. |
| B2 | Select Version / Revision / Replacement Part in turn | Body shows the **existing Part or Tool** picker (`<Item>`), not the new-part form. |
| B3 | Select **New Part** | Body swaps to the mini-form: **Part Number** (auto-populated), **Name**, **Type** (Part/Tool), **Replenishment System** (Buy/Make/Buy and Make). The `<Item>` picker is gone. |
| B4 | In New Part mode, switch **Type** Part → Tool | The auto-minted **Part Number** re-mints for the new type (e.g. a tool sequence). |
| B5a | New Part mode, clear Name, submit | Validation error "Name is required"; nothing created. |
| B5b | Existing mode (Version), submit with no item picked | Validation error "Item is required". |

---

## C. New Part — net-new creation & authoring

| ID | Steps | Expected |
|---|---|---|
| C1 | Add affected item → New Part, **Make**, keep auto number, Name "Consolidated Bracket", Add | A new **explorer row** appears reading `NEW → {minted number}`; the app navigates to its detail. |
| C2 | On the New Part detail | Shows **Properties** (attributes) + **Bill of Material** + **Bill of Process** editors (empty), a **Changes** card, and **NO** cutover / Part Supersession card. Badge = **New** (green). |
| C3 | DB: the minted item | `SELECT active, "revisionStatus", "changeOrderId" FROM item WHERE "readableId" = '{number}';` → `active = f`, `revisionStatus = Design`, `changeOrderId` = the CO id. Its make method: `SELECT status, "changeOrderId" FROM "makeMethod" mm JOIN item i ON i.id = mm."itemId" WHERE i."readableId" = '{number}';` → `status = Draft`, `changeOrderId` = the CO. |
| C4 | On the New Part detail, look for the change-type switcher | **Absent** — a New Part cannot be switched to another type. |
| C5 | Add affected item → New Part, open the **Type** select | Only **Part** and **Tool** offered (no Material/Consumable/Service). |
| C6 | Author the New Part's BOM: add 2 components; author a BOP operation | Edits persist (reload the line — they remain); the **Changes** card lists the added materials/operation as additions. |
| C7 | Add a **New Part, Buy** | Detail shows **Properties** + **Supplier Parts** grid; **no** BOM/BOP editor (Buy has no method). |

---

## D. Consolidation (N→1) authoring

Precondition: ASM-A (3 components C1/C2/C3) + a New Part created in C1.

| ID | Steps | Expected |
|---|---|---|
| D1 | In the same CO, Add Affected Item → **Version**, pick **ASM-A** | ASM-A added as a Version affected item; its draft BOM editor shows C1, C2, C3. |
| D2 | On ASM-A's draft BOM, delete C1, C2, C3; **Add material** and open the item picker | The **New Part draft** (inactive) is **selectable** in the picker (it appears because the picker is `includeInactive`). Select it, set quantity 1. |
| D3 | Open ASM-A's **Changes** card | Shows **3 removed** (C1/C2/C3) and **1 added** (the New Part). No "modified". |
| D4 | Open the CO overview **Changes rollup** | Shows both the New Part's own additions (its BOM) and ASM-A's remove/add. |
| D5 | (edge) Try to add ASM-A's own BOM line referencing a Material | Allowed only per the picker's `validItemTypes` (Consumable/Material/Part) — Tools excluded as components, as before. (Regression, not new behavior.) |

---

## E. Release — supersession semantics & ordering

Advance the CO: Draft → Start → Engineering Complete → Implementation, then **Release** (Implementation → Done).

| ID | Steps | Expected |
|---|---|---|
| E1 | Release the CO | CO status = **Done**; no error. |
| E2 | DB: the New Part after release | `active = t`, `changeOrderId` = CO (stamped). **No supersession**: `SELECT count(*) FROM "itemSupersession" WHERE "successorItemId" = '{newPartItemId}';` → **0**. |
| E3 | Open ASM-A's item master (Manufacturing) | Its **active** method now has the new BOM: New Part present, C1/C2/C3 gone. |
| E4 | DB: the removed components are untouched | C1/C2/C3 still `active = t`; **no** `itemSupersession` was written for them by this CO. ASM-B's BOM still references C1. |
| E5 | Regression of the redirect map | Create a job from **ASM-B** (which still uses C1) → its job BOM still pulls **C1** (no redirect to the New Part — the consolidation was local to ASM-A). |
| E6 | Ordering sanity | ASM-A's released method references the New Part as an **active** item (the New Part was revealed active before ASM-A's method flipped — no dangling/inactive component reference). |

---

## F. Replacement Part (renamed) — still supersedes

| ID | Steps | Expected |
|---|---|---|
| F1 | New CO; Add Affected Item → **Replacement Part**, pick an existing manufactured part P | New affected item; badge **Replacement**; detail shows Properties + BOM/BOP editors + **cutover / Part Supersession** card; the minted new item has a new part number derived from P's (e.g. `…0029` → `…0030`). |
| F2 | Author a change, release | DB: an `itemSupersession` **is** written, predecessor = P's item, successor = the new part. `active = t` on the new part. |
| F3 | Badge everywhere (explorer + card) | Reads **Replacement** (orange), distinct from **New** (green). |

---

## G. Negative / guard cases

| ID | Steps | Expected |
|---|---|---|
| G1 | On an existing (Version/Revision/Replacement) affected item, open the change-type switcher | Options are **Version / Revision / Replacement Part** — **New Part is not offered**. (Buy items also hide Version.) |
| G2 | POST a change-type switch to `New Part` directly (e.g. via a crafted request) | Rejected — flash "New Part change type cannot be switched" (route guard + `updateChangeOrderAffectedItemChangeType` guard). |
| G3 | Attempt a New Part with a non Part/Tool type (not possible via UI; test the service guard) | Rejected — "New Part is only supported for Parts and Tools". |
| G4 | Remove a New Part affected item from the CO | Its draft (and the minted item, if the discard path deletes it) is discarded; the explorer row disappears; no orphaned active item. |

---

## H. Regression — existing CO behaviors preserved

| ID | Steps | Expected |
|---|---|---|
| H1 | Add a **Version** affected item, author a BOM change, release | New Active method version on the same item, prior Active → Archived; **no** new item, **no** supersession. |
| H2 | Add a **Revision** affected item, release | New revision item revealed active; **oldRev→newRev** `itemSupersession` written; cutover card was present. |
| H3 | Badges | Version = `Version N`; Revision = **New Revision**. |
| H4 | Add a **Buy** item as **Version** | Coerced to **Revision** on add (Buy has no BoM/BoP). |
| H5 | (prior work) Open an item that's a Revision/New Part draft under an open CO on its item master | Its CO-owned draft BOM/BOP renders and is editable, in sync with the CO. |
| H6 | (prior work) Parts table | Surfaces the **active** revision, not an inactive CO draft revision. |

---

## I. Data-integrity queries (reference)

```sql
-- Affected items of a CO with their change types + draft refs
SELECT "changeType", "itemId", "newItemId", "baseMakeMethodId", "draftMakeMethodId"
FROM "changeOrderAffectedItem" WHERE "changeOrderId" = '<coId>';

-- Supersession written by a release
SELECT "itemId" AS predecessor, "successorItemId" AS successor, "supersessionMode"
FROM "itemSupersession" WHERE "companyId" = '<companyId>' ORDER BY "createdAt" DESC LIMIT 10;

-- New Part must have NONE of the above as successor:
SELECT count(*) FROM "itemSupersession" WHERE "successorItemId" = '<newPartItemId>';  -- expect 0

-- A CO-owned draft method is cleared at release (idempotency marker)
SELECT id, status, "changeOrderId" FROM "makeMethod" WHERE "changeOrderId" = '<coId>';  -- empty after release
```

---

## J. Automated coverage (already green — re-run before merge)

```bash
pnpm --filter erp exec vitest run app/modules/items/items.service.test.ts   # 15 tests, incl. N→1 consolidation diff
pnpm exec turbo run typecheck --filter=erp                                    # scoped typecheck
pnpm exec turbo run typecheck --filter=@carbon/database                       # seed
```

---

## Pass criteria

- All of A–H pass in the browser + the DB checks match.
- No supersession is ever written for a **New Part** (E2, I).
- Removed consolidation components are untouched globally (E4, E5).
- Existing "New Part" COs behave exactly as before under the **Replacement Part** label (A3, F2).
- Automated coverage (J) is green.

## Known risk to watch (from the impl checkpoint)

- **New Part draft visibility in the assembly BOM picker (D2):** the minted inactive part must be present in the client `useItems` store for the `includeInactive` picker to show it. If it doesn't appear immediately after minting, reload the CO page (store re-sync) and retry; if it still doesn't appear, that's a real bug (store not carrying the just-minted inactive item) — capture it.
