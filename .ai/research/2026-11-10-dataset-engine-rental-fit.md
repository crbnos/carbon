# Fitting rental agreements into the demo dataset engine

Read-only research, 2026-11-10. Paths are relative to the worktree root
`/Users/aashu/work/carbon/carbon/.claude/worktrees/fix-rental-contacts-demo-data`.
`DS` = `packages/database/src/datasets`. Every claim cites the file:line I read.
Lines marked "(inference)" are my own reasoning and I did not verify them by running anything.

---

## 1. Fixed assets today

- **Tier:** tier 09, "Accounting + fixed assets" (`DS/tiers/index.ts:28`). The block sits at the END of `runTier9`, after journals, invoice postings, memos and payments (`DS/tiers/09-accounting.ts:241-390` come first, the fixed-asset block starts at `:392`).
- **Spec type:** `FixedAssetSpec` (`DS/types.ts:1908-1940`), carried in `AccountingData.fixedAssets` (`DS/types.ts:2323`). Fields: key, className, location (`"Plant" | "HQ"`), name, description, serialNumber, status, depreciationMethod, usefulLifeMonths, residualValuePercent, acquisitionCost, offsets, accumulatedDepreciation, optional depreciationCharge / assetLifetimeUsage / usageLogs / disposal.
- **Statuses:** `"Draft" | "Active" | "Fully Depreciated" | "Disposed"` (`DS/types.ts:1915`). The validator requires every `fixedAssetStatus` enum value except "Under Construction" (`DS/validate.ts:437-444`).
- **Per dataset:** 6 assets each, the same shape: Buildings Active, M&E Active (CMM / dyno / VMC), M&E Draft, Vehicles Fully Depreciated, M&E Disposed (Sale), and one M&E Units-of-Production Active asset. For example satellite `DS/data/satellite/accounting.ts:19-137` (hvac, cmm, cnc Draft, van, tvac Disposed, laser UoP); robotics `DS/data/robotics/accounting.ts:17-135`; motor `DS/data/motor/accounting.ts:17-136`; precision `DS/data/precision/accounting.ts:19-133`; defense `DS/data/defense/accounting.ts:20-136`.
- **Rentable / fleet: none.** No spec uses class "Rental Fleet". The tier inserts no `itemId`, `trackedEntityId`, `workCenterId` or out-of-service columns (`DS/tiers/09-accounting.ts:419-445`). The `fleetAssets` view only returns assets `WHERE fa."itemId" IS NOT NULL` (`packages/database/supabase/migrations/20261006220501_rental-agreements.sql:296`), so no seeded asset shows on the fleet screen today. The "Rental Fleet" class itself exists: bootstrap inserts every `fixedAssetClasses` entry (`DS/bootstrap.ts:374-376`), and the class is defined at `packages/database/src/seed-data.ts:2411-2425` (asset acct 1370, accum. depr. 1380, 60 months, 20% residual). Tier 09 looks classes up by name, or falls back to the first one (`DS/tiers/09-accounting.ts:395-412`).
- **Depreciation and journals:** no depreciation journal is posted. Tier 09 writes ONE **Draft** `depreciationRun` with one `depreciationRunLine` per asset that has `depreciationCharge` (`DS/tiers/09-accounting.ts:488-512`). A disposal writes a `fixedAssetDisposal` row with NBV and gain/loss computed in the tier (`:462-473`). I found no journal for an acquisition or a disposal in the tiers or helpers (grep of `DS/tiers/09-accounting.ts` and `DS/helpers/*.ts` for disposal/depreciation). The validator checks the run charge against the app's math (`DS/validate.ts:6422-6500`).
- **Refs:** tier 09 registers each asset as `ctx.refs.documents["fixedAsset:<key>"]` (`DS/tiers/09-accounting.ts:446`). The validator registers the same key (`DS/validate.ts:792-794`).
- **Coverage floors:** `fixedAsset: 6`, `fixedAssetDisposal: 1`, `fixedAssetUsageLog: 2` (`DS/coverage.ts:71-73`).

**What a fleet unit needs:** `fixedAsset.itemId` + `trackedEntityId` (`20261006220401_fleet-bridge.sql:9-15`), `quantity = 1` (`:27`), and at most one non-Disposed asset per serial (`:40-42`). `FixedAssetSpec` cannot express `itemId` or `trackedEntityId` today, so the spec type needs two optional fields: `item`, and a serial `readableId` that tier 09 mints as a Consumed `trackedEntity`. (inference) A capitalized stock unit is "consumed" into its asset (`.claude/rules/fixed-asset-lifecycle.md:317-319`). The customer-asset pattern mints a Consumed serial directly (`DS/tiers/04-sales.ts:942-949`), so it is the closest shape to copy.

---

## 2. Which tier, and the sibling pattern

### Constraint: refs by tier

| Ref a rental needs | Written by | Where |
|---|---|---|
| customer id | tier 01 | `ctx.refs.customers` (`DS/tiers/01-foundation.ts:383` reads it) |
| customer location (`cloc:<customer>`) | tier 01 | `DS/tiers/01-foundation.ts:407` |
| customerContact id | **not stored anywhere** | see section 3 |
| item | tier 02 | `ctx.refs.items` |
| serial (`te:<readableId>`) | tier 03 | `DS/tiers/03-inventory.ts:105` |
| fixed asset (`fixedAsset:<key>`) | tier 09, end of tier | `DS/tiers/09-accounting.ts:446` |
| plant / HQ location | tier 01 | `ctx.refs.locations` |
| payment term | tier 01 | `ctx.refs.misc.paymentTermId` (`DS/tiers/01-foundation.ts:342`) |
| GL accounts | bootstrap (`companyGroupId`-scoped) | tier 09 builds `accountIdByNumber` (`DS/tiers/09-accounting.ts:97-106`) |

Tier order is the contract (`DS/AGENTS.md:94-98`). A rental line needs the fixed asset, so **rental agreements cannot be seeded in tier 04**: the fixed assets do not exist until tier 09. There are two choices:

1. **Seed rentals in tier 09, right after the fixed-asset block** (`DS/tiers/09-accounting.ts:392-474`). This is the smallest change. The data can still live in the sales slice: tier 09 already reads `ctx.dataset.sales.*`. `postServiceJobTime` reads `ctx.dataset.sales.serviceJobs` (`DS/helpers/post-documents.ts:734-737`), and `seedContractProjects` updates tier 04's contracts (`DS/tiers/09-accounting.ts:860-885`).
2. If a **deposit payment** must be Posted, it has to exist before or inside the payments loop (`DS/tiers/09-accounting.ts:288-381`), because that loop is the only caller of `postPayment`, and `loadPostingContext` needs tier 09's periods (`:128-129`). So either:
   - move the fixed-asset block (and the rentals) up, before the payments loop. (inference) The block reads only `fixedAssetClass`, locations and sequences and writes no journal, so moving it should not change any `journalEntryId`. I did not run this.
   - or insert the agreement header before the payments loop and its lines after the fixed assets.

Tier 10 would also see every ref, but it cannot post: `loadPostingContext(ctx, periods)` takes tier 09's periods (`DS/helpers/post-documents.ts:51-54`).

### Closest siblings in the engine

**A. Contracts: tier 04, the "Active document with a schedule, but no real invoice" pattern** (`DS/tiers/04-sales.ts:651-843`):
- Header inserted Active and confirmed (`status: "Active"`, `confirmedAt/By`, `createdAt` from the start offset), with readable id `nextSequence(ctx, "customerContract")` (`:713-736`).
- Lines inserted in order, ids kept in a local `lineIdByKey` (`:738-758`).
- The schedule comes from the shared PURE planner (`planInvoiceSchedule` + `horizon` from `packages/database/src/contract-schedule.ts`, imported at `DS/tiers/04-sales.ts:15-20`). Every invoice dated on or before today is `Billed Externally`, later ones are `Planned`, so **no drafted salesInvoice exists for tier 09 to journal** (comment `:651-657`; statuses `:760-762`).
- Downstream rows go in the same loop: `customerContractInvoice` + `customerContractInvoiceLine` (`:760-780`), `customerContractRevenue` from `planRevenueSchedule` (`:782-815`), opening `customerContractLedgerEntry` (`:817-848`), and `ctx.refs.documents["con:<key>"]` (`:849`).
- Spec: `ContractSpec` (`DS/types.ts:928-962`). Data: `DS/data/satellite/sales.ts:989+` (`CONTRACTS`), wired at `:1241`.
- Validator: `sales.contracts` must not be empty (`DS/validate.ts:1329`), plus per-contract checks (`:3070-3091`). Floors: `customerContract*` (`DS/coverage.ts:41-47`).

**B. Service jobs: tier 04, the "Invoiced, with a Draft sales invoice" pattern** (`insertServiceInvoice`, `DS/tiers/04-sales.ts:1199-1310`):
- Inserts an opportunity, then `salesInvoice` **Draft** with subtotal/total, then `salesInvoiceShipment`, then `salesInvoiceLine` rows with the source column (`serviceJobId`), then stamps the source (`UPDATE serviceJob SET salesInvoiceId`).
- Tier 09's `postSalesInvoices` skips Draft invoices (`DS/helpers/post-documents.ts:161-165`), so no journal is needed.

**Recommended shape for rentals (inference):** copy A for the agreement (header Active + lines + persisted `rentalBillingPeriod` rows, from the same pure billing planner the app uses). Copy B for the rent invoice: one **Draft** `salesInvoice` with `invoiceLineType 'Rental'` lines carrying `rentalAgreementId`, `rentalAgreementLineId`, `rentalBillingPeriodId` and `rentalLineType 'Rent'`. That satisfies `salesInvoiceLine_rental_check` (`20261006220501_rental-agreements.sql:207-210`). Then stamp `rentalBillingPeriod.salesInvoiceLineId` + `status 'Invoiced'`.

### Blockers and gaps for that shape

- **The billing planner lives in `@carbon/utils`** (`packages/utils/src/rental-periods.ts`, `generateRentalBillingPeriods` at `:330`). `@carbon/database` cannot import `@carbon/utils`: it is not among its dependencies (`packages/database/package.json:101-113`), and the dependency runs the other way (root `AGENTS.md` → Precision; `DS/rule-fields.ts:18`). The contract planners were moved into `@carbon/database` for exactly this reason. Their exports are at `packages/database/package.json:38-42`, and `packages/utils/src/revenue-schedule.ts:5-6` says "Lives in @carbon/database so the contract revenue planner and the demo dataset share it". `rental-periods.ts` imports only `@carbon/database/lease-months`, `@carbon/database/precision` and `./revenue-schedule.ts`, which is itself a re-export of `@carbon/database/revenue-schedule` (`packages/utils/src/rental-periods.ts:5-17`). So it can move to `@carbon/database` with no new dependency, following the contract precedent. The alternative is to hand-author periods and have the validator recompute them.
- **No "Billed Externally" status for rentals.** `rentalBillingPeriodStatus` is only `Pending | Invoiced` (`packages/database/src/constants.ts:944`). The only CHECK on the table is the memo CHECK (`20261007171726_rental-credit-memos.sql:29-31`), so `Invoiced` with a null `salesInvoiceLineId` is allowed by the schema. (inference) No app path writes that state, so the honest past periods are Draft-invoiced ones or Pending ones.
- **Posted rental invoices are not supported by the seed posting path.** `postSalesInvoices` throws for any non-`Part` line, or any line without `salesOrderLineId`, on a non-Draft invoice: "has a line the seeded posting shape does not cover" (`DS/helpers/post-documents.ts:203-216`). The validator mirrors this with Part-only `salesInvoiceJournal` (`DS/validate.ts:6578-6595`). The real Rent posting (Cr Contract Assets / Cr Deferred Revenue + Deferral schedule rows) is in the ERP (`planRentalLine`, `apps/erp/app/modules/invoicing/invoicing.service.ts:8651-8790`), which `@carbon/database` cannot import. Keep the rental invoices Draft, or plan a real porting task.
- **Activation journal:** a `Rental` (operating) line writes no journal at activation. A `Sale` line books a `'Lease'` commencement journal and more (`apps/erp/app/modules/sales/AGENTS.md`, Rentals → Lifecycle and Sales-type commencement; the posting is `postRentalAgreement` in `apps/erp/app/modules/sales/sales.service.ts`, called from `activateRentalAgreement`, `apps/erp/app/modules/sales/sales.server.ts:5060-5094`). (inference) Seed only `Rental`-classified lines: Active needs no journal then. Setting `lessorClassification = 'Rental'` and `activatedAt` on an Active agreement is enough.

---

## 3. Customer contacts: how they are seeded and referenced

- Spec: `CustomerContactSpec = ContactSpec & { customer }` (`DS/types.ts:109-116`), in `foundation.customerContacts` (`DS/types.ts:233`).
- Tier 01 loop (`DS/tiers/01-foundation.ts:381-414`), per contact:
  1. `contact` row (isCustomer true), with **the `contact.id`** stored at `ctx.refs.contacts["<customer>:<lastName>"]` (`:384-391`);
  2. an `address`, plus a `customerLocation` named "Billing", stored at `ctx.refs.misc["cloc:<customer>"]` (`:393-407`). Each contact makes its OWN location, and a second contact for the same customer **overwrites** `cloc:`;
  3. a `customerContact` row (`:409-413`). **Its id is not stored in any ref.**
- Suppliers are different: the `supplierContact` id IS stored, at `ctx.refs.contacts["sc:<supplier>"]` (`DS/tiers/01-foundation.ts:467-473`), and tier 05 reads it for `supplierContactId` (`DS/tiers/05-purchasing.ts:305`, `:402`, `:468`). No tier sets any `customerContactId` today (a grep of `DS/tiers/*.ts` for `customerContactId` found nothing).
- Data: every dataset has exactly **one contact per customer**: satellite 4 (`DS/data/satellite/foundation.ts:277-306`), robotics 4 (`:288`), precision 4 (`:297`), motor 4 (`:310`), defense 6 (`:306`). These counts come from my grep and uniq of `customer:` in each `CUSTOMER_CONTACTS`.
- The validator only knows `customersWithContacts` as a set of customer names (`DS/validate.ts:1214`, `needCustomer` `:1255-1263`).

**For rentals:**
- `rentalAgreement.customerContactId` and `rentalAgreementContact.customerContactId` both reference `customerContact.id` (`20261006220501_rental-agreements.sql:39`; `20261104063711_rental-agreement-contacts.sql:9`). A BEFORE INSERT trigger refuses a primary contact that belongs to another customer (`20261104063711_rental-agreement-contacts.sql:63-70`, `:83-87`).
- Tier 01 needs a new ref, e.g. `ctx.refs.contacts["cc:<customer>:<lastName>"] = customerContactId`, mirroring `sc:`.
- `rentalAgreementContact` rows (the non-primary contacts) need a **second contact per renting customer** in `CUSTOMER_CONTACTS`. That second contact also mints another "Billing" location and re-points `cloc:` to it (`DS/tiers/01-foundation.ts:402-407`). (inference) This is harmless, but it changes which location every later `cloc:` reader gets, and adds `address` / `customerLocation` / `contact` rows. Either accept it, or give the contact spec a flag to reuse the first location.
- The unique key is (agreement, contact) (`20261104063711_rental-agreement-contacts.sql:22-23`), and the primary contact must never be a row in that list (`:1-3`).

---

## 4. wipe.ts

How it works (`DS/wipe.ts:393-519`):
0. `assertWipeable`: refuses intercompany partners, non-Draft `charge` and non-Draft `reimbursement` (`:252-296`).
1. `reverseDocumentJournals`: for every Posted journal whose `sourceType` is in `DOCUMENT_JOURNAL_SOURCES` and whose lines (or `payment` / `memo` / `reimbursement.journalId`) point at a row about to go, it inserts a negated Posted `VOID …` entry dated today (`:306-391`).
2. The wipe finds tables by their `companyId` column and skips `PRESERVED_TABLES` (`:18-77`, `:130-143`, `:399-400`). **New rental tables are wiped automatically, and `fixedAssetClass` is preserved** (`:30`).
3. The wipe deletes these first, outright: `TRANSIENT_MRP_TABLES`, `MODEL_SLIDE_TABLES` and `PARENT_CHECK_TABLES` (`:410-420`).
4. The wipe sets non-Draft sales and purchase invoices to Draft (`:431-439`).
5. The wipe deletes `invoiceSettlement`, `payment` and `memo` (`:445-451`).
6. The wipe deletes the document headers (salesInvoice, salesOrder, …), and their lines cascade (`:457-472`).
7. `nullNullableReferences`: every nullable FK into the delete set is set to NULL (`:227-248`, `:474`).
8. Topological delete over the NOT NULL edges (`:187-221`, `:476-483`), then orphan groups, non-bootstrap locations, `resetSequences`, and `assertWipeClean` (`:485-518`).

What rentals would need (each from the schema):
- `rentalAgreement`, `rentalAgreementLine`, `rentalAgreementCharge`, `rentalBillingPeriod`, `rentalAgreementContact`, `rentalLeaseScheduleLine`, `itemRentalRate` and `customerItemRentalRate` all have `companyId`, so the wipe clears them with no list change. Their NOT NULL composite FKs cascade from agreement → line → charge / period (`20261006220501_rental-agreements.sql:120-121`, `:150-151`, `:184-185`).
- **`rentalBillingPeriod.memoId` → `memo` is `ON DELETE RESTRICT`** (`20261007171726_rental-credit-memos.sql:24-27`). The wipe deletes `memo` in step 5, BEFORE nulling FKs (`DS/wipe.ts:445-451`). If the dataset seeds a rental credit memo (an early-return adjustment), that delete fails. Fix: delete `rentalBillingPeriod` (or null `memoId`) before the memo delete. (inference) Adding it to `PARENT_CHECK_TABLES` would work, because those are deleted first (`:410-420`), but that list is meant for CHECK tables (`:105-107`).
- **`shipmentFixedAssetLine` / `receiptFixedAssetLine`** CHECK `num_nonnulls(salesOrderLineId|purchaseOrderLineId, rentalAgreementLineId) = 1`, with a nullable `rentalAgreementLineId` FK (`20261008155056_rental-documents.sql:7-15`, `:30-38`). If the dataset seeds rental delivery / return documents, the nulling pass empties both columns and trips the CHECK. Add both tables to `PARENT_CHECK_TABLES` (rule: `packages/database/AGENTS.md` "A new table whose CHECK needs one of several nullable FKs…"). No dataset seeds these tables today (a grep of `DS` for `FixedAssetLine` found nothing).
- `salesInvoiceLine_rental_check` (`20261006220501_rental-agreements.sql:207-210`): `salesInvoiceLine.rentalAgreementLineId` has no FK (my grep of the migrations found FK constraints for that column on the shipment/receipt line tables only), so the nulling pass does not touch it. Invoice lines go with their header in step 6 ("Cascade via the parent headers", `DS/wipe.ts:453-456`).
- `payment.rentalAgreementId` is `ON DELETE SET NULL` and covered by a `<= 1` CHECK (`20261006220501_rental-agreements.sql:226-235`). Payments are deleted in step 5 anyway. The same goes for `memo.rentalAgreementId` (`20261007171726_rental-credit-memos.sql:12-16`).
- The `rentalAgreement` contact trigger fires on the nulling pass's `customerContactId = NULL` update. The update keeps `customerId`, and the "other customer" refusal only runs for a non-null contact (`20261104063711_rental-agreement-contacts.sql:44-70`). (inference) Safe.
- `fixedAsset.itemId` / `trackedEntityId` are nullable `ON DELETE RESTRICT` FKs (`20261006220401_fleet-bridge.sql:10-11`), so step 7 nulls them before the delete.
- **Journals:** `DOCUMENT_JOURNAL_SOURCES` has no `Lease` or `Lease Run`, and the document union has no `rentalAgreement` (`DS/wipe.ts:306-317`, `:339-348`). (inference) Fine for Draft-only rental invoices and `Rental`-classified lines, which write no journal. A seeded `Sale` line (`'Lease'` commencement journal) or a posted lease run would leave a live journal for a deleted document, so it would need list changes.
- **`assertWipeable`** has nothing rental-specific. Only intercompany partners and non-Draft charge / reimbursement are refused (`DS/wipe.ts:252-296`). I found no trigger refusing deletion of an Active `rentalAgreement`: a grep of migrations for triggers on rental tables found only the contact triggers. So no new guard is needed for the shapes above.
- `verify.ts` re-applies each dataset with `wipeFirst: true`, which is what catches a broken wipe (`.claude/rules/onboarding-company-templates.md` "Layer 2", rule text at `:655-660`).

---

## 5. validate.ts and coverage.ts: what a new document type needs

`validate.ts` (7,988 lines) has two layers (`DS/AGENTS.md:155-161`).

- **`buildIndex`** (`DS/validate.ts:1127-1230`): builds the shared projections once (refs, items, contacts, BOM walks, `documentRefs`, on-hand ledger, lots, floor state). Type `DatasetIndex` is at `:1105-1125`.
- **`documentRefs`** (`DS/validate.ts:665-800`): every declared ref in tier order, plus duplicate detection. `register(where, ref)` (`:669-673`). Fixed assets register `fixedAsset:<key>` (`:792-794`). Contracts are NOT registered: their `con:` ref is set by the tier (`DS/tiers/04-sales.ts:849`) but not here. (inference) Rentals should register `ra:<key>` after the fixed assets, so `uniqueDocumentRefs` (`:1266-1270`) catches duplicates.
- **Rules:** `type Rule = (ctx: ValidationCtx) => void` (`:1243`), with ctx helpers `fail`, `need(kind, where, id)` and `needCustomer` (`:1245-1264`). `RULES` lists them in report order (`:7947-7982`); `validateDataset` runs them all (`:7984-7988`). A sales-shaped check goes in `sales` (`:2828`) or `fieldService` (`:2758`); posting checks go in `postings` (`:6526`); asset checks go in `accounting` (`:5888`, assets at `:6422-6500`). Per `DS/AGENTS.md:160-161`, a new check goes in its slice's rule, and a fact two slices share goes in the index.
- **Non-empty arrays:** the `nonEmpty` list inside `foundation` (`:1282-1360`; `sales.contracts` at `:1329`, `accounting.fixedAssets` at `:1344`). A new `sales.rentalAgreements` array should be added there.
- **COVERAGE** (`:188-503`): `{ values, missing }` per set. `enumValues(name, except)` reads the generated enum minus reasoned exceptions (`:168-173`), so a new enum value fails every dataset until one exhibits it. `checkCoverage(fail, { key: seenSet })` is called from the owning rule (`:506-514`; e.g. fixed assets `:6500`, service jobs `:2749`).
- Rental enums that a COVERAGE entry would pull in (`packages/database/src/constants.ts:607`, `:941-947`): `rentalAgreementStatus` Draft/Active/Closed/Cancelled; `rentalAgreementLineStatus` Pending/On Rent/Returned/Sold; `rentalBillingCycle` Calendar Month/28 Days/Monthly; `rentalBillingTiming` Advance/Arrears; `rentalBillingPeriodStatus` Pending/Invoiced; `rentalInvoiceLineType` Rent/Charge/Purchase Option; `rentalRateUnit` Day/Week/Month; `lessorClassification` Rental/Sale/Financing. Each value the datasets will not exhibit needs an `except` reason (as fixed assets do with `NOT_AUTHORABLE`, `:437-444`). For example: Sold / Purchase Option / Sale / Financing need a sales-type lease, and Closed needs every unit back and everything invoiced.
- Checks a rental rule would want (inference): customer has a contact (`needCustomer`); every line's `fixedAsset:` key exists and is a fleet asset (item + serial, class "Rental Fleet", status Active or Fully Depreciated, as activation requires per `apps/erp/app/modules/sales/AGENTS.md` Rentals → Lifecycle); one live line per asset (DB partial unique index `20261006220501_rental-agreements.sql:130-132`); `rate > 0` on Active (activation refuses rate 0, same AGENTS); `endDate > startDate` (`:68`); contact list never repeats the primary contact.

**`coverage.ts`** (`DS/coverage.ts`):
- `COVERAGE_FLOORS` (`:10-289`): per-table minimum row count after apply. Floor = the smallest count any dataset produced, ×0.8 for volume tables (`:5-9`). No rental table is listed today (my grep found no `rental` in the file). Each new seeded table needs an entry (e.g. `rentalAgreement`, `rentalAgreementLine`, `rentalBillingPeriod`, `rentalAgreementContact`, `fixedAsset` raised from 6 if fleet units are added), and `salesInvoice` / `salesInvoiceLine` (`:217-218`) can be raised.
- `DATASET_COVERAGE_FLOORS` (`:299-312`): only for content ONE dataset carries (today only satellite). Use it only if rentals ship in a subset of datasets.
- `COVERAGE_SCOPES` (`:318-328`): only for tables not counted by `companyId`. Rental tables need no entry.
- Rule: "Added or removed rows on purpose? Update `coverage.ts` in the same change" (`DS/AGENTS.md:172-173`).

---

## 6. Posted-document journals: is there a pattern to follow?

- `helpers/posting-journals.ts` holds PURE builders, shared by tier 09 and the validator so both derive identical lines (`DS/helpers/posting-journals.ts:16-20`; `DS/AGENTS.md:36-40`). Each builder returns a `PostingJournal { sourceType, description, lines: PostingLine[] }` (`:51-85`), where a line carries a `role` (an `accountDefault` column) and its class (`POSTING_ROLE_CLASS`, `:22-49`). `PostingSourceType` lists only 8 sources, without `Lease` (`:51-59`).
- `helpers/post-documents.ts` is the DB side: `loadPostingContext` resolves each role from `accountDefault` and checks the account class (`:51-82`); `insertPostingJournal` asserts balance, takes `nextJournalEntryId`, picks the period with `periodFor`, inserts `journal` + `journalLine` (`:94-149`); `postSalesInvoices` / `postPayment` / `postServiceJobTime` call it (`:151-234`, `:690-728`, `:730+`).
- **Sales invoice builder:** `salesInvoiceJournal` wraps `buildSalesPostingLines` with `invoiceLineType "Part"` only (`DS/helpers/posting-journals.ts:143-201`). `buildSalesPostingLines` itself supports `Rental`, but **requires `revenueLegs`** for it (`packages/database/src/sales-posting-amounts.ts:131-135`, `:357-358`). Those legs come from the ERP's `planRentalLine` (`apps/erp/app/modules/invoicing/invoicing.service.ts:8651`): Rent → Contract Assets for unbilled accruals + Deferred Revenue (plus Deferral recognition rows); Charge → Rental Income (`:8671-8686`); Sale lines → Net Investment in Leases (`:8689-8714`). For a seeded rent invoice with no accruals this reduces to Dr AR / Cr Deferred Revenue (2160), plus `revenueRecognitionSchedule` Deferral rows. (inference) The seed would have to author those rows too, because posted documents carry their downstream rows (`DS/AGENTS.md:129-131`). A **Charge** line is the simplest posted rental line: Dr AR / Cr Rental Income (4060), with no schedule rows (`invoicing.service.ts:8671-8686`).
- **A pattern a rental posting could follow:** `postServiceJobTime` + `serviceJobTimeJournal` is the precedent for a posting that resolves extra `accountDefault` columns outside `POSTING_ROLE_CLASS`. It reads `costOfServiceAccount`, `costOfGoodsSoldAccount`, `warrantyExpenseAccount` and `laborAbsorptionAccount` itself and checks the class (`DS/helpers/post-documents.ts:740-760`; builder `DS/helpers/posting-journals.ts:543-580`). A rental posting would do the same for `deferredRevenueAccount` / `rentalIncomeAccount` / `contractAssetAccount` (`packages/database/src/seed-data.ts:2361-2363`). It would also have to drop the Part-only throw in `postSalesInvoices` (`DS/helpers/post-documents.ts:203-216`) and the matching validator mirror (`DS/validate.ts:6578-6595`).
- **Deposit:** `buildPaymentJournal` already supports `isDeposit` + `depositAccountId` (Customer Prepayments, a liability) for a payment that references a rental agreement (`packages/database/src/build-payment-journal.ts:105-113`, `:149-154`). The ERP passes `defaults.prepaymentAccount` (`apps/erp/app/modules/invoicing/invoicing.service.ts:13121-13124`), which is account 2110 "Customer Prepayments" in the seed (`packages/database/src/seed-data.ts:1267-1269`, `:2335`). But the seed's `paymentJournal` passes neither flag (`DS/helpers/posting-journals.ts:301-357`). `PaymentSpec` says "Σ amount must equal `amount`" (`DS/types.ts:2007`) and has no `rentalAgreement` field (`:1993-2011`), and tier 09 never sets `payment.rentalAgreementId` (`DS/tiers/09-accounting.ts:294-316`). A Posted deposit needs: a `rentalAgreement?` field on `PaymentSpec`, `isDeposit`/`depositAccountId` in `paymentJournal`, a `prepaymentAccount` role, and the agreement inserted before the payments loop (section 2).
- **Activation:** no journal for `Rental` lines (section 2). A sales-type commencement (`'Lease'` journal, asset Disposed, schedule rows) is far outside the current helpers. Recommend leaving it out.

---

## 7. Rental-related rows in `packages/database/src/seed-data.ts`

Sequences (`sequences`, `:261+`):
- `rentalAgreement` / "Rental Agreement" / prefix `RA`, size 6 (`:600-608`). The migration also backfills it per company (`20261006220501_rental-agreements.sql:246-250`). The tiers get it via `ensureSequences` (`DS/sql.ts:224-243`), and `resetSequences` rewinds it on wipe (`DS/sql.ts:251-260`).
- Neighbours used by rentals: `salesInvoice` (`:427`), `payment` (`:535`), `creditMemo` (`:565`; rental credit memos use it, per `apps/erp/app/modules/sales/AGENTS.md`), `fixedAsset` (`:508`), `fixedAssetTransfer` `FAT` (`:592-598`), `revenueRecognitionRun` `RR` (`:583-586`), `leaseRun` `LR` (`:619-622`), `lease` `LSE` (`:610-612`, the lessee side), `customerContract` `CON` (`:628-631`).

Accounts (`accounts`, `:775+`):
- 1370 Rental Fleet, Fixed Asset (`:1079-1090`); 1380 Accumulated Depreciation – Rental Fleet (`:1091-1102`).
- 4060 Rental Income, Revenue (`:1642-1652`); 4070 Lease Revenue (`:1654-1656`); 4150 Interest Income – Leases (`:1740-1742`).
- 2160 Deferred Revenue (`:1315-1317`); 1145 Contract Assets (`:895-897`); 1160 Net Investment in Leases (`:919-921`); 2110 Customer Prepayments (`:1267-1269`).

Account defaults (`accountDefaults`, `:2293-2366`): `deferredRevenueAccount: "2160"` (`:2361`), `contractAssetAccount: "1145"` (`:2362`), `rentalIncomeAccount: "4060"` (`:2363`), `leaseRevenueAccount: "4070"` (`:2364`), `leaseInterestIncomeAccount: "4150"` (`:2365`), `netInvestmentInLeasesAccount: "1160"` (`:2366`), `prepaymentAccount: "2110"` (`:2335`).

Fixed asset class (`fixedAssetClasses`, `:2368+`): "Rental Fleet", Straight Line, 60 months, 20% residual, asset 1370, accum. depr. 1380 (`:2411-2425`).

---

## 8. Where rentals data goes, and what each industry could rent

**File:** each slice is one file in `DS/data/<key>/` (`DS/AGENTS.md:25`). The closest home is `data/<key>/sales.ts`, beside `CONTRACTS` and the service-job data (`SalesData` at `DS/types.ts:1080-1098`: `contracts`, `customerAssets`, `serviceJobs`). The fleet units themselves are `FixedAssetSpec`s, so they go in `data/<key>/accounting.ts` `FIXED_ASSETS` (e.g. `DS/data/satellite/accounting.ts:19`). Optional item rate cards (`itemRentalRate`) would sit with the items or the rentals (inference). The data must stay pure literals (no ids, no `Date`) (`DS/AGENTS.md:25`, `:122-128`). Customer contacts for the agreement contact list go in `data/<key>/foundation.ts` `CUSTOMER_CONTACTS`.

**Rentable equipment.** A fleet unit needs an item (the fleet view joins `item`). The app's rate card is for serial-tracked parts (`apps/erp/app/modules/sales/AGENTS.md`, `itemRentalRate` row: "serial-tracked parts"). Serial-tracked items per dataset, from `trackingType: "Serial"` in each `items.ts`:

| Dataset | Serial items (file:line) | Plausible rental story (inference, not in code) |
|---|---|---|
| satellite | `RW-010` Reaction Wheel (`DS/data/satellite/items.ts:56-60`), `SAT-1000` Smallsat Bus (`:285-290`) | a flight-spare reaction wheel, or an engineering-model bus rented to a research customer for integration testing |
| robotics | `MOT-AC-750W` Servo Motor (`DS/data/robotics/items.ts:38-44`), `ROB-2000` Vertex 10 Robot Arm (`:288-293`) | demo / pilot robot arms rented to an integrator; robotics already sells "Fleet Uptime Support" (`DS/data/robotics/items.ts:275-280`) |
| precision | `CYL-HYD-40` Hydraulic Cylinder (`DS/data/precision/items.ts:130-136`), `HMA-4000` HPU Manifold Assembly (`:289-294`) | a loaner hydraulic power unit / manifold while a customer's unit is repaired |
| motor | `ENC-INC-2048` Encoder (`DS/data/motor/items.ts:87-93`), `MTR-9000` / `MTR-4500` Servo Motor Assemblies (`:292-306`) | loaner servo motors for a customer line during a rebuild, or a motor test-stand unit |
| defense | `ESC-80A-NDAA`, `FC-NDAA-H7`, `MCU-EDGE-16`, `GNSS-CRPA-4`, `GCS-100` Ground Control Station, `ISR4-AV` Air Vehicle, `ISR4-SYS` UAS System (`DS/data/defense/items.ts:94-523`) | the strongest fit: ISR-4 systems / ground stations leased to an agency for an evaluation or an exercise; defense already has an "emergency agency fleet" story (`DS/data/defense/sales.ts:884`) |

Notes:
- A fleet serial should be a NEW `trackedEntity`, not one of the `onHandTracked` serials (e.g. `RW010-SN-0051`, `DS/data/satellite/inventory.ts:51-53`). Those feed the on-hand ledger the validator balances (`DS/validate.ts` `netOnHand`; index `onHand` `:1225`). (inference) A Consumed serial per fleet asset, as `seedCustomerAssets` does (`DS/tiers/04-sales.ts:942-949`), avoids touching stock.
- Each dataset's existing tools (`TOOLS`, e.g. `DS/data/satellite/items.ts:234-243`: torque driver set, VNA cal kit) are not serial-tracked, so they are weaker fleet candidates.

---

## 9. Running the checks

- Command: `pnpm db:check:datasets`, or `pnpm db:check:datasets -- --dataset <key>` (repeatable) (root `package.json:61` → `packages/database/package.json:88` → `tsx src/check-datasets.ts`; usage `packages/database/src/check-datasets.ts:17`, `:36-42`).
- **Layer 1, no DB:** `validateDataset` runs first for every selected dataset and exits 1 on any violation, before any connection (`packages/database/src/check-datasets.ts:106-129`).
- **Layer 2, DB needed:** it **skips with a warning** when `SUPABASE_DB_URL` is unset (`:131-137`), when the connection fails (`:139-149`) or when there are no users (`:153-154`). With a DB, it applies each dataset to a scratch company in a transaction, asserts `COVERAGE_FLOORS`, re-applies with `wipeFirst: true`, and always rolls back (`.claude/rules/onboarding-company-templates.md` Layer 2, ~`:642-675`). It reads the LIVE schema, so run `pnpm db:migrate` first (root `AGENTS.md` Validation Commands).
- So a local DB is **not required** for the pure validator. It **is required** to prove the tiers apply and the wipe survives. The pre-commit hook runs it on any `packages/database/**` change; `CARBON_SKIP_DATASET_CHECK=1` skips it (`packages/database/src/check-datasets.ts:13`, `:125`).
- A real seed for eyeballing: `pnpm db:seed:dev -- --email you@example.com --dataset satellite` (`DS/AGENTS.md:151-152`; script at root `package.json:66`).

---

## Summary of engine changes a rentals spec implies (inference)

1. `FixedAssetSpec` gains optional `item` + `serial`. Tier 09 mints a Consumed serial and sets `itemId` / `trackedEntityId`. Use class "Rental Fleet", status Active.
2. Tier 01 stores `cc:<customer>:<lastName>` → `customerContact.id`. Datasets add a second contact for each renting customer.
3. Add `SalesData.rentalAgreements: RentalAgreementSpec[]`, seeded in tier 09 after the fixed assets: header (RA sequence, `Active` with `activatedAt` / Draft), lines (`lessorClassification 'Rental'` on Active), `rentalAgreementContact` rows, `rentalBillingPeriod` rows, optional `rentalAgreementCharge`.
4. Billing periods come from `generateRentalBillingPeriods`, moved into `@carbon/database` (contract-schedule precedent). Otherwise they are hand-authored and the validator recomputes them.
5. Rent / charge invoices stay **Draft** `Rental` lines (service-job precedent). Posting them needs new builders plus Deferral rows.
6. Optional Posted deposit: `PaymentSpec.rentalAgreement` + `isDeposit` in `paymentJournal`, ordered before the payments loop.
7. Validator: register `ra:` refs, add `sales.rentalAgreements` to `nonEmpty`, add COVERAGE entries with reasoned `except` values, and add a rentals rule. Add `COVERAGE_FLOORS` entries.
8. Wipe: nothing for headers / lines / periods / contacts. If credit memos are seeded, delete `rentalBillingPeriod` before `memo`. If rental shipments / receipts are seeded, add the two `*FixedAssetLine` tables to `PARENT_CHECK_TABLES`.
