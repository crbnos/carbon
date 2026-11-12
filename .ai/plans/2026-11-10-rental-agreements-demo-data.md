# Rental agreements in the demo datasets — implementation plan

**Spec / source:** `.ai/specs/2026-11-10-rental-agreements-demo-data.md`
**Branch:** `fix/rental-contacts-demo-data`

## Progress
- [x] Task 1: Move `rental-periods` and `lessor-lease` into `@carbon/database`
- [x] Task 2: Extend the dataset contract (types)
- [x] Task 3: Tier 01 — customer contact ref and `sharesLocation`
- [x] Task 4: Tier 09 — fleet units on fixed assets
- [x] Task 5: Tier 09 — `seedRentalAgreements`
- [x] Task 6: Wipe — `shipmentFixedAssetLine` in `PARENT_CHECK_TABLES`
- [x] Task 7: Validator rule, document refs, coverage floors
- [x] Task 8: Data for the five datasets
- [x] Task 9: Gates and end-to-end check

## Dependencies
Task 2 needs nothing. Tasks 3–7 need Task 2. Task 5 needs Tasks 1, 3 and 4.
Task 8 needs Tasks 2–7. Task 9 needs all.

Paths below: `DS` = `packages/database/src/datasets`.

---

## Task 1: Move `rental-periods` and `lessor-lease` into `@carbon/database`

**Depends on:** none
**Files:**
- Create: `packages/database/src/rental-periods.ts`, `packages/database/src/lessor-lease.ts` (moved bodies)
- Create: `packages/database/src/rental-periods.test.ts`, `packages/database/src/lessor-lease.test.ts` (moved tests)
- Modify: `packages/database/package.json` — add exports `./rental-periods`, `./lessor-lease`
- Modify: `packages/utils/src/rental-periods.ts`, `packages/utils/src/lessor-lease.ts` — one-line re-exports
- Copy from (precedent): `packages/utils/src/revenue-schedule.ts` (re-export shim)

**Steps:**
1. Use `git mv` to move each file and its test into `packages/database/src/`.
2. In the moved files, change `@carbon/database/<x>` imports to relative `./<x>.ts` imports.
3. Change `./revenue-schedule.ts` in the moved files to the database package's own `./revenue-schedule.ts`.
4. Write the two `@carbon/utils` shims: SPDX header, a one-line comment, `export * from "@carbon/database/<name>";`.
5. Add the two entries to `exports` in `packages/database/package.json`, next to `./revenue-schedule`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/rental-periods.test.ts src/lessor-lease.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/database
# Expected: 0 errors
```

**Out of scope:** callers of `@carbon/utils` (they keep importing from it).

## Task 2: Extend the dataset contract (types)

**Depends on:** none
**Files:**
- Modify: `DS/types.ts` — `CustomerContactSpec`, `FixedAssetSpec`, `SalesData`, new `RentalAgreementSpec`

**Steps:**
1. Add `sharesLocation?: true` to `CustomerContactSpec`.
2. Add `fleet?: { item: string; serial: string }` to `FixedAssetSpec`.
3. Add `RentalAgreementSpec` with the shape in the spec §2. Replace `fixedAsset` with the asset `key`.
4. Add `rentalAgreements: RentalAgreementSpec[]` to `SalesData`.

**Verify:** `pnpm --filter @carbon/database typecheck` — expected: errors only in the five `data/*/sales.ts` files (missing `rentalAgreements`). Task 8 fixes those.

## Task 3: Tier 01 — customer contact ref and `sharesLocation`

**Depends on:** Task 2
**Files:** Modify `DS/tiers/01-foundation.ts` (customer-contact loop, about line 381)

**Steps:**
1. If `cc.sharesLocation`, reuse `need(ctx.refs.misc, "cloc:<customer>")` and skip the address and location inserts.
2. Store the `customerContact` id at `ctx.refs.contacts["cc:<customer>:<lastName>"]`.

**Verify:** typecheck as Task 2.

## Task 4: Tier 09 — fleet units on fixed assets

**Depends on:** Task 2
**Files:** Modify `DS/tiers/09-accounting.ts` (fixed-asset loop, about line 402)
**Copy from:** `DS/tiers/04-sales.ts` `seedCustomerAssets` (Consumed serial insert)

**Steps:**
1. If `spec.fleet` is set, insert a `trackedEntity`: the item, `readableId = serial`, quantity 1, status `Consumed`, `sourceDocument "Item"`.
2. Insert the `fixedAsset` with `itemId` and `trackedEntityId`.
3. Update the serial's `attributes` to `{"Fixed Asset": <asset id>}`, the shape `accounting.service.ts:14096` writes.
4. Store the serial id at `ctx.refs.misc["fleet-serial:<key>"]`.

## Task 5: Tier 09 — `seedRentalAgreements`

**Depends on:** Tasks 1, 3, 4
**Files:** Modify `DS/tiers/09-accounting.ts` — a new function called right after the fixed-asset loop.
**Copy from:** `apps/erp/app/modules/sales/sales.service.ts:17592-17903` (activate), `apps/erp/app/modules/inventory/inventory.service.ts:18700-18777` (post rental shipment), `apps/erp/app/modules/shared/shared.service.ts:14998-15024` (shipment header + line).

**Steps (per spec):**
1. Read `companySettings` `leaseDefaultDiscountRate`, `leaseMajorPartThresholdPercent`, `leaseSubstantiallyAllThresholdPercent` once.
2. Read the base currency's `decimalPlaces` once.
3. Insert the `rentalAgreement` header:
   - `rentalAgreementId = nextSequence(ctx, "rentalAgreement")`, the customer, `customerLocationId` = `cloc:`.
   - `customerContactId` = `cc:` (the primary contact), `locationId` = Plant, the base currency.
   - The discount rate, the dates and the cycle/timing.
   - `invoiceAutomation 'Draft Only'`. Active also gets `activatedAt`.
4. Insert one `rentalAgreementContact` row per extra contact, with `sortOrder` = its index.
5. Insert the lines: `fixedAssetId`, `itemId`, `trackedEntityId`, `rateUnit`, `rate`, `fairValue`, `economicLifeMonths`.
6. Do these steps for Active lines only:
   1. Call `leasePaymentTerms`, then `classifyRentalLine`.
   2. Write `lessorClassification` and `classificationInputs` from the record.
   3. Call `generateRentalBillingPeriods` with `through = billingHorizon(cycle, anchor)`.
   4. Insert the periods in the `billingPeriodRow` shape.
7. Do these steps for delivered lines only:
   1. Insert one Posted `shipment` per agreement (`sourceDocument 'Rental Agreement'`, `postingDate` = the delivery date).
   2. Insert one `shipmentFixedAssetLine` per delivered line (`shipped true`).
   3. Set the line to `On Rent` and set `deliveredAt`.
   4. Insert a `Rental Delivery` `trackedActivity` and a `trackedActivityInput` (qty 1), with attributes `{Shipment, "Rental Agreement"}`.
8. Insert the `rentalAgreementCharge` rows.
9. Store `ctx.refs.documents["ra:<key>"]`.

## Task 6: Wipe

**Depends on:** Task 2
**Files:** Modify `DS/wipe.ts` `PARENT_CHECK_TABLES` (line 108). Add `"shipmentFixedAssetLine"` with a one-line reason comment.

## Task 7: Validator rule, document refs, coverage floors

**Depends on:** Task 2
**Files:** Modify `DS/validate.ts`, `DS/coverage.ts`

**Steps:**
1. Register `ra:<ref>` after the fixed assets in `documentRefs` (about line 792).
2. Add `["sales.rentalAgreements", …]` to the non-empty list (about line 1329).
3. Add a `rentals` rule to `RULES` with the checks in spec §5.
4. Add coverage floors: `rentalAgreement: 2`, `rentalAgreementLine: 3`, `rentalAgreementContact: 1`, `rentalAgreementCharge: 1`, `rentalBillingPeriod: 2`, `shipmentFixedAssetLine: 1`. Raise `fixedAsset` to 9.

## Task 8: Data for the five datasets

**Depends on:** Tasks 2–7
**Files:** Modify `DS/data/<key>/accounting.ts` (3 fleet assets), `DS/data/<key>/foundation.ts` (1 extra contact with `sharesLocation`), `DS/data/<key>/sales.ts` (`RENTAL_AGREEMENTS` + wire into the slice). Do this for `satellite`, `robotics`, `precision`, `motor` and `defense`.

Each dataset gets the rows in spec §6. Fleet assets use class "Rental Fleet", status Active, location Plant, and serials `<item>-RNT-00n`.

**Verify:**
```bash
pnpm --filter @carbon/database typecheck   # Expected: 0 errors
pnpm --silent db:check:datasets            # Expected: validator clean ×5; apply + floors + wipe pass if the DB is up
```

## Task 9: Gates and end-to-end check

**Depends on:** all
1. Run `pnpm exec biome check` on the changed files.
2. Run the typecheck for `@carbon/database`, `@carbon/utils`, `erp` and `@carbon/jobs`.
3. Run `pnpm db:check:datasets`. If the local DB is down, report that the DB layer was skipped.
4. Update `DS/AGENTS.md` and `.claude/rules/onboarding-company-templates.md` where they list what the datasets seed.

**Out of scope:** committing (the user commits on request).
