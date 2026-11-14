# Saving an item's details keeps its Active setting

Bug: the update branch of `upsertPart`, `upsertTool`, `upsertConsumable` and
`upsertService` wrote `active: true` to the item row. Every details save (the
item forms, `items_updatePart`, `items_updateTool`, `items_updateConsumable`,
`items_updateService`) activated an inactive item. It also activated an item an
unreleased change notice created, which `setItemActive` refuses.

## Tasks

- [x] Leave `active` out of the four update writes in `items.service.ts`.
  Creates keep `active: true`.
- [x] Type `updateTypedItem`'s item write without `active`, so a caller cannot
  add it back without a type error.
- [x] `upsertMaterial`: no change. Its update writes only the sent keys of
  `materialItemUpdateFields`, which has no `active`.
- [x] List every other writer of `item.active` and every caller of the four
  updates; record which, if any, relied on a save to activate an item.
  - Change-notice release (`releaseAffectedItem`) writes `active: true` itself.
  - Revisions (`createRevision`) and change-notice drafts insert with their own
    `active`.
  - The Onshape release push creates items through the create branch and edits
    existing items through `applyExistingItemFields`, which does not write
    `active`.
  - Invoice, RFQ and quote line part creation use the create branch.
  - The CSV import writes `item.active` from its own Active column (default
    true), not through these updates. Unchanged; noted as a follow-up.
  - None relied on a save to activate an item.
- [x] Tests in `apps/erp/test/items-operations.test.ts`: an inactive item stays
  inactive after `updatePart`, `updateTool` and `updateConsumable`; a part an
  unreleased change notice created stays inactive after `updatePart`. They fail
  without the fix.
- [x] Sync: operation remarks (published tool descriptions), items `AGENTS.md`,
  `docs/content/docs/reference/items.mdx` (Active field).
- [x] Verify: erp typecheck, the test file, Biome, `pnpm check:manifest`.
