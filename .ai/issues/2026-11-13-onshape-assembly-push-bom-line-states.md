# Onshape assembly push: sourceless BOM rows stay "Conflict", duplicate hand-entered lines survive

Filed: 2026-11-13 · Found investigating a customer's second push of a multi-level assembly
from the Onshape v2 panel, read against main `cae1f5a879`.
Status: OPEN. Fix both in one branch: they share `plan.ts`, `status.ts`, `Panel.tsx`,
`review.ts` and one live test document.

## Issue 1: a BOM row with no Onshape source shows "Conflict" on every push

### Symptom

- The panel's status view shows the row as a red **Conflict**. Tooltip: "Carbon already has an
  item with this part number, not linked to this one in Onshape. Pushing uses that item."
- Pushing again never clears it. Every review lists the row under "N parts match existing
  Carbon items", which says to renumber any that are different parts.
- `docs/content/docs/integrations/cad.mdx:520` tells the user to push to clear a Conflict, which
  cannot work for these rows.
- In the case found, the seven Conflict rows were the last seven rows of the top-level BOM. They
  had no mapping row in any integration, no STEP model and no linking error after two pushes.
  Every other row in the tree was linked.

### Root cause

- A link is keyed by the row's Onshape source. `externalIdForBomLine`
  (`packages/ee/src/onshape/panel/status.ts:223`) returns null when `itemSource` has no
  `documentId` or `elementId`.
- `parseBomTree` sets `itemSource: null` when the BOM row carries none
  (`packages/ee/src/onshape/panel/bom.ts:142`, `:170`).
- Apply: `linkChildParts` skips the row without a problem message
  (`apps/erp/app/modules/settings/settings.service.ts:7549`).
- Status: `buildAssemblyLineStatuses` (`status.ts:241`) can then only return `matched`. Its
  docstring says so (`status.ts:189`). The panel renders `matched` as Conflict (`Panel.tsx:6920`).
- Review: `buildAssemblyPlan` sets `conflict: true` on any reuse row whose part number is not in
  `linkedPartNumbers` (`plan.ts:1735`). The Conflict badge (`Panel.tsx:6279`) and the conflicts
  list (`Panel.tsx:5474`) follow from that flag.
- Probable origin: Onshape non-geometric BOM items. These are rows added in the BOM table with no
  part behind them, such as hose by length, clamps and consumables.
  - Unverified: read the BOM API JSON for such a row and record what `itemSource` holds.
  - Evidence from the case found: the rows sorted after every modelled row, including a modelled
    part added in a later push.
  - Elimination: the other no-link causes each leave a trace. An already-linked source or item
    leaves a link. A source with two part numbers leaves a push error. A failed insert leaves an
    error and is retried on the next push.

### Replicate

1. Run the local stack with the v2 panel app connected (`crbn up --no-portless`, the `ONSHAPE_V2_*`
   env vars).
2. In Onshape, build an assembly with one modelled part (part number `P-100`).
3. In the same assembly's BOM table, add a non-geometric item with part number `P-200`.
4. Push the assembly from the panel. Both items are created and `P-100` is linked.
5. Reopen the panel. `P-200` shows **Conflict**.
6. Push again. The review lists `P-200` under "parts match existing Carbon items", and the status
   view still shows Conflict.
7. `externalIntegrationMapping` has no `onshape-v2` item row for `P-200`.

Unit level: `buildAssemblyLineStatuses` with a line whose `itemSource` is null, plus an item whose
`readableId` equals the line's part number, returns `matched`.

### Suggested fix

- Add a line state for a row with no Onshape source, for example `bomOnly`.
  - Add it to the `PanelAssemblyLineStatus` state union and return it from
    `buildAssemblyLineStatuses` when `externalIdForBomLine` is null and an item matches.
  - The status route returns these through `buildAssemblyLineStatuses`
    (`apps/erp/app/routes/api+/integrations.onshape.panel.status.ts:348`). The root's own state
    (`:333`) is unaffected: the root always has a source.
- Render it as a neutral badge, for example "BOM only", with a tooltip such as: "This row has no
  part in Onshape, so it can't be linked. The push writes its BOM line with the Carbon item that
  has this part number."
- In `buildAssemblyPlan`, do not set `conflict` on a reuse row whose source key is null. Carry a
  flag so the review shows the same badge, and keep the row out of the conflicts list.
- Unchanged: linking, the BOM line write, and released and linked states.
- Tests:
  - `status.test.ts`: a sourceless line returns the new state.
  - `plan.test.ts`: a sourceless reuse row is not a conflict.
- Docs: the status table in `cad.mdx:248`, the troubleshooting row at `cad.mdx:520`, and the
  status section of `.claude/rules/onshape-panel.md`.

## Issue 2: duplicate hand-entered BOM lines survive the push and are described as "Not in Onshape's BOM"

### Symptom

- An assembly is pushed onto a make method that already has hand-entered lines. Afterwards the
  method holds the pushed lines plus leftover hand lines for parts Onshape already lists, so
  demand is counted twice.
- The review warns "N lines added by hand in Carbon stay — Not in Onshape's BOM, so these BOMs
  won't match it." In the case found, 10 of the 11 lines listed were parts Onshape did list.
- The warning offers no way to remove a line.
- `cad.mdx:300` promises that a hand line for a part Onshape lists is taken over. Only one line
  per part number is.

### Root cause

- `pairManualLines` (`plan.ts:222`) pairs each Onshape write with at most one hand line of the
  same part number in the same make method, in order. Every other hand line goes to `keeps`.
- Same-level duplicates:
  - Onshape sends one row per part number per level, with the total quantity.
  - A hand BOM that splits a part over two lines gets its first line taken over at Onshape's full
    quantity, while the second line stays and adds on top.
  - Example: hand lines `P-1 ×4` and `P-1 ×1`, Onshape `P-1 ×5`. After the push the method has
    `P-1 ×5` and `P-1 ×1`, so demand is 6.
- Cross-level duplicates:
  - Pairing only looks within one make method.
  - A flat hand BOM can list parts that Onshape places inside a sub-assembly, such as a weldment.
  - The parent's hand lines for those parts match nothing at the parent level, so they stay.
  - The sub-assembly's make method gets the pushed lines, so the parts are counted at both levels.
- Review copy: `Panel.tsx:5681-5690` describes every kept line as "Not in Onshape's BOM", and the
  method summary counts them as "manual kept" (`review.ts:782`).
- Keeping hand lines is deliberate: a push never deletes Carbon lines it did not write. The bug is
  that the push treats every leftover hand line the same way, not the no-delete rule.

### Replicate

1. In Carbon, make part `A-100` with a Draft make method of hand-entered lines: `P-1 ×4`,
   `P-1 ×1`, `P-2 ×1`, `P-3 ×1`.
2. In Onshape, build assembly `A-100` with `P-1 ×5` at the top level and sub-assembly `S-1`
   containing `P-2 ×1`. Leave `P-3` out of Onshape.
3. Push `A-100` with depth all.
4. The review shows "3 lines added by hand in Carbon stay — Not in Onshape's BOM" for `P-1 ×1`,
   `P-2 ×1` and `P-3 ×1`. The description is true only for `P-3`.
5. After apply:
   - `A-100`'s Draft holds `P-1 ×5` (taken over), `P-1 ×1`, `P-2 ×1`, `P-3 ×1` and `S-1 ×1`.
   - `S-1` holds `P-2 ×1`.
   - Demand for `P-1` is 6 and for `P-2` is 2.

Unit level: `pairManualLines` with writes `[P-1 ×5]` and manual lines `[P-1 ×4, P-1 ×1]` returns
`keeps = [P-1 ×1]`.

### Suggested fix

- Classify each kept hand line:
  - `duplicate`: its part number is written by Onshape in the same make method (one hand line
    was already taken over), or anywhere in a descendant make method of the same push.
  - `extra`: Onshape lists its part number nowhere in the pushed tree. The current wording stays
    true for these.
- Return `{ takesOver, duplicates, keeps }` from `pairManualLines`. The caller (`plan.ts:1802`)
  passes the part numbers written by descendant methods, which the BOM tree already holds.
- Review:
  - Add a separate list, for example "N lines added by hand repeat parts Onshape already lists".
  - Give each duplicate line a "Remove" checkbox, ticked by default.
  - Keep "Not in Onshape's BOM" for `extra` lines only.
  - Report both counts in `describeMethod` (`review.ts:782`).
- Apply:
  - Delete the ticked duplicate lines in the same transaction as the owned-line writes.
  - Delete only from the Draft the push writes into. Active methods are never edited
    (`ensureDraftMakeMethod`).
  - Before deleting, re-check each line, since the plan can be stale: it must still exist, carry
    no `onshape-v2` mapping row, and belong to the target Draft.
  - When the push makes a new Draft version from the Active one, the copied lines get new ids.
    Map the plan's line ids onto the copies the way `pairOwnedCopiedLines` / `carryLineOwnership`
    carry ownership.
  - Unticked lines stay.
- Do not merge quantities into the taken-over line. Onshape's quantity is already the total, so
  summing would keep the double count.
- Tests:
  - `pairManualLines`: same-level and cross-level cases.
  - `plan.test.ts`: a parent hand line for a sub-assembly part is classed `duplicate`.
  - Apply: ticked duplicates are deleted, unticked ones are kept, and an `extra` line is never
    deleted.
  - Mutation check.
- Docs: `cad.mdx:298-301`, and `.claude/rules/onshape-panel.md:87` ("Other manual lines are left
  alone").

## Out of scope

- New items take the company's push defaults (`panel/preferences.ts`: Make, Make to Order), so
  bought parts created by a push come in as Make unless the reviewer changes them or the company
  changes its defaults. That is configuration, not this bug.
