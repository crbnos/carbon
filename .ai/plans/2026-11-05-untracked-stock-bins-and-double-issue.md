# Untracked stock bins and the double issue

Decisions (user, 2026-11-05): split a short draw across bins; a shipment that
would take a bin negative warns through the rule dialog and can be confirmed;
one PR for all three.

## 1. Untracked job consumption takes stock from the bin that holds it

Rule (`planStripedUntrackedDraw`, `@carbon/database/picked-consumption`, pure):
take from the preferred bin up to its on-hand, then from the other bins with
stock (nettable named bins and "no storage unit"), fullest first. A shortfall
stays on the preferred bin, else the first bin drawn, else no storage unit.
Strict backflush is unchanged (it refuses instead).

- [x] Pure planner + unit test
- [x] `issueJobOperationMaterials` (completion backflush) uses it
- [x] `partToOperation` (MES manual issue and step backflush) uses it for a
      planned material and an unplanned part
- [x] `backflush_job_materials` (job completion SQL) gets the same split, in a
      new migration forked from `20261104161337`
- [x] Database test for the SQL split

## 2. Shipments take untracked stock from a bin that holds it

- [x] Shipment create keeps a bin the order line names, and fills a line with
      no bin from the bins that hold the item's untracked stock
- [x] Quote → order conversion falls back to the fullest bin like the order form
- [x] `postShipment` warns (rule dialog, acknowledge to post) when an untracked
      line's bin holds less than the shipped quantity, naming the bins that have it
- [x] The storage unit quantity hint sums the rows of each bin

## 3. One completion never issues a unit's material twice

- [x] `issueJobOperationMaterials` caps each material at what the completed
      units need in total, less what is already issued (step backflush counts)
- [x] `partToOperation` locks the job material row before reading `quantityIssued`
- [x] Tests

## Verification

- [x] `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database`: passes.
- [x] `picked-consumption.test.ts`: 32 pass.
- [x] ERP unit tests in `app/modules/inventory`, `app/modules/shared` and `app/routes/api+`: 567 pass.
- [x] Biome on the changed files: no new warnings.
- [x] `pnpm --filter @carbon/checks clobbers`: no clobber risks.
- [x] Database tests: `consumption-bins.test.ts`, `strict-backflush.test.ts`, `non-nettable-fullest-bin.test.ts`, `convert-quote-location.test.ts`, `post-shipment/`, `issue/` (94 pass). SQL tests: `backflush-split-across-bins`, `backflush-project-stripe`, `backflush-layer-children`, `non-nettable-storage`, `job-completion-*` pass.
- [x] `pnpm db:check:datasets` and `pnpm db:check:backups` pass.
- [x] Browser test (`.ai/playbooks/stock-bin-selection.md`): every flow passes.

## Found while testing

1. With no bin chosen, the split skipped stock with no storage unit (both in TypeScript and in SQL). Fixed: no storage unit is a candidate when no bin is named.
2. `strict-backflush.test.ts` asserted the old rule (a short bin moves the whole draw to the fullest bin). It now asserts the split.
