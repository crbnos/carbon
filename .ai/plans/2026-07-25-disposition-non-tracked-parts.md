# Disposition of non-tracked parts from a failed inspection

## Problem

Today disposition is driven entirely by tracked-entity links
(`nonConformanceItemTrackedEntity`):

- `AssociatedItemsList.tsx:220` filters to `rows.filter(r => r.links.length > 0)`
  and returns `null` when nothing has links — a non-tracked part's disposition
  card is **hidden**.
- `closeIssue` (`quality-disposition.server.ts`) does `if (row.links.length === 0)
  continue;` in its validation and posting loops — a non-tracked row's disposition
  is **silently ignored** at close.

So a non-tracked part (`Inventory` / `Non-Inventory`) that fails inspection — or a
MES job-operation quality issue (`quality-issue.new.tsx`, which already creates a
link-less `nonConformanceItem` with a real `quantity`) — gets an NCR row you can't
see and a disposition that does nothing.

## Decisions (resolved with user)

- **Ledger model: Option A** — keep the inspection reject's compensating on-hand
  removal for `Inventory` as-is (quarantine at reject). Disposition adds the
  minimal inventory effect only.
- **No split for non-tracked** — one disposition per non-tracked row (the existing
  split/move UI stays gated on `links.length > 0`, so it's already excluded).
- **Works for MES too** — MES-originated NCRs are dispositioned on the ERP Issue
  page. `closeIssue`/`AssociatedItemsList` are source-agnostic, so no new MES UI is
  built in this change. (A shop-floor disposition control in `AssemblyView` is a
  possible follow-up, explicitly out of scope here.)

### Correct ledger effect per origin × disposition (non-tracked)

| Origin | Reject pre-removed on-hand? | Scrap / Return | Use As Is / Rework |
|---|---|---|---|
| Inspection, `Inventory` | yes (`−lot` at reject) | no-op (already gone) | **`+qty` restore** |
| Inspection, `Non-Inventory` | no (never had a ledger) | no-op | no-op |
| MES / manual | no | no-op (WIP scrap is a separate production concern) | no-op |

Net: the **only** ledger `closeIssue` posts for a link-less row is a `+qty`
`Positive Adjmt.` to restore on-hand when an **inspection-originated** **Inventory**
lot is **kept** (Use As Is / Rework), undoing the reject's `Negative Adjmt.`
Everything else non-tracked is a quality record only. Origin is detected via the
presence of a `nonConformanceInspection` link on the NCR (only the reject route
creates one, and it always removes on-hand for `Inventory`).

## Tasks

### 1. `apps/erp/app/modules/quality/ui/Issue/AssociatedItemsList.tsx`
- Stop hiding link-less rows: render all `rows` (was `rows.filter(r => r.links.length > 0)`).
- `sumMismatch` only applies when links exist: `links.length > 0 && Math.abs(linkedSum - quantity) > 1e-6`.
- Entity chips, split, and "Move entities" are already gated on `links.length > 0` — non-tracked rows show just quantity + the disposition `Select`. Update the stale header comment.
- Verify: `pnpm exec turbo run typecheck --filter=@carbon/erp`.

### 2. `apps/erp/app/modules/quality/quality-disposition.server.ts` (`closeIssue`)
- Preflight + in-transaction validation loops: check `Pending` for **all** rows;
  skip only the link-sum / link-status checks for link-less rows.
- Before the posting loop, batch-load `item.itemTrackingType` for link-less rows'
  item ids and detect inspection origin (`nonConformanceInspection` link).
- In the posting loop, handle `row.links.length === 0`: post the `+qty` restore for
  inspection-originated `Inventory` on Use As Is / Rework; otherwise record only.
- Verify: `pnpm exec turbo run typecheck --filter=@carbon/erp` + `pnpm --filter @carbon/erp test`.

### 3. Docs
- Update `.claude/rules/issue-module.md` + `.claude/rules/inspection-system.md`
  disposition notes to reflect non-tracked support.

## Verification
- Typecheck ERP.
- Browser: reject a non-tracked (Inventory) inbound inspection → NCR opens → the
  Disposition card now shows the quantity row; set Use As Is → close → on-hand
  restored. Set Scrap → close → no extra ledger. MES quality issue on a non-tracked
  part → dispositionable + closes on the ERP Issue page.
