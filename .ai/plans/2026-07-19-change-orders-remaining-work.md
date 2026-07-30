# Change Orders (ECO) — Remaining Work

**Status:** The change-orders feature shipped on `feat/change-orders-top-to-bottom`.
The current, accurate design is the source of truth in
`apps/erp/app/modules/items/AGENTS.md` → "Change Orders (sub-area)". This plan
captures ONLY the work still open after that; it deliberately does not
re-describe shipped behavior.

This consolidates six earlier change-order plans (v1 top-to-bottom, v2
reuse-method-tables, conflict-resolver, supplier-parts + changes-rollup,
new-part + consolidation, and its test plan). The superseded/shipped design docs
were removed after their still-open items were folded in below.

## Do NOT resurrect (dead approaches, intentionally removed)

Designed in earlier plans and deliberately dropped — don't rebuild them:

- Staged mirror tables (`changeOrderStaged*`) — replaced by a real CO-owned
  Draft `makeMethod` (`makeMethod.changeOrderId`).
- The 2-way merge / conflict resolver at release (`ChangeOrderConflictResolver`,
  `getChangeOrderReleaseDiff`, `reconcileDraftWithLive`, `applyTheirs`,
  `buildReleaseConflictEntries`) — release is a plain review-then-confirm dialog
  now; releasing a Version just appends a new Active version.
- The one-open-CO-per-part guard — same-part parallel COs are allowed
  (`findOtherOpenChangeOrdersForItem` is advisory only).
- `getChangeOrderImpact` PO-lines table — replaced by the where-used
  `ImpactPanel`.
- `mintPlaceholderPart` exists but is unwired; `plmReleaseControl` /
  `item.releaseStatus` enforcement was not adopted.

## Open / deferred work

### 1. Tool affected items + Tool attribute editing under a CO
The service layer accepts Tools, but there is no UI path to add a **Tool** as an
affected item, and embedded attribute editing (`PartProperties` `embedded`
variant) is wired for **Parts only**. Add the Tool add-path and a
`ToolProperties`-embedded editor so a Tool Revision / Replacement Part / New Part
can edit attributes on the CO line.
_Sources: AGENTS.md "Deferred (not yet built)"; v2 plan Task 11 (`PartProperties`
deferral, now Parts-only); new-part plan Task 5 ("Tool attribute editing remains
a follow-up")._

### 2. "Used in N other assemblies" indicator on removed diff lines
On the Changes diff, a removed BOM component line should show a where-used count
("used in N other assemblies") so the author sees the blast radius inline. Needs
a loader decision — a per-removed-component `getPartUsedIn` is a heavier query,
hence deferred. Where-used is currently only reachable via each part's detail
page and the CO `ImpactPanel`.
_Source: new-part plan Task 7 step 2 (marked `[~]`/PENDING)._

### 3. (Backlog) NCR-style templated / gating action tasks
V1 ships only freeform, non-gating `changeOrderActionTask`. The
templated/gating action-task machinery (the Q7 fast-follow) was explicitly
deferred and never built.
_Source: v2 plan out-of-scope ("NCR-style action templates (Q7 fast-follow, not
this version)")._

## Verification

End-to-end browser verification of the shipped feature is not yet recorded as
run. The full manual/e2e matrix is the verification gate:
`.ai/plans/2026-07-19-change-order-new-part-and-consolidation-test-plan.md`
(sections A–J: rename regression, net-new New Part, N→1 consolidation, release
supersession semantics, guard/negative cases, regression matrix). A cached
playbook also exists at
`.ai/playbooks/change-order-new-part-consolidation.md`.

**Known risk to watch (D2):** a minted inactive New Part must be present in the
client `useItems` store for the `includeInactive` assembly-BOM picker to show it.
If it doesn't appear immediately after minting, reload the CO page (store
re-sync) and retry; if it still doesn't appear, that's a real bug (store not
carrying the just-minted inactive item) — capture it.
