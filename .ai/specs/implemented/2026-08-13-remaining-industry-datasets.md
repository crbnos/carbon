# Spec — demo datasets for the three remaining onboarding industries

- **Status:** Draft, awaiting approval
- **Date:** 2026-08-13
- **Branch:** `feat/onboarding-templates`
- **Research:** [`.ai/research/2026-08-13-remaining-industry-datasets.md`](../research/2026-08-13-remaining-industry-datasets.md)
- **Prior art:** [`.ai/specs/implemented/2026-08-13-onboarding-company-templates.md`](implemented/2026-08-13-onboarding-company-templates.md)

## Summary

Onboarding offers four industries. Only one — Aerospace & Satellite — has a demo dataset
behind it; the other three are currently hidden from the picker because a template that
promises sample data and delivers an empty company is worse than no option at all.

This adds datasets for the remaining three (`robotics_oem`, `precision_manufacturing`,
`automotive_precision`) at full parity with satellite, and does the engine work that adding a
second dataset actually requires — the tiers are not industry-agnostic today despite the
stated contract.

## Problem

Three concrete problems, in order of severity:

1. **The engine assumes satellite.** `tiers/06-production.ts:101` reads the literal ref key
   `"job:in-progress"` through `need()`, so a dataset whose jobs are keyed differently throws
   and rolls back the entire transaction. `tiers/03-inventory.ts:13` looks up shelf names the
   engine generated (`A1-L1`…`A3-L3`, `CleanRoom`), so a dataset using different shelf strings
   has **all** its opening stock silently dropped while the company still looks provisioned.
2. **Satellite's business content lives in shared code.** The plant is hard-coded to
   `4500 Space Commerce Drive, Houston, TX 77058` on `America/Chicago`
   (`tiers/01-foundation.ts:66-74`), with two fixed shifts, three fixed warehouses, a
   clean-room shelf, a printer at `http://192.168.1.50:9100`, and a supplier literally named
   `"Orbital Staffing"`. Every industry would inherit an aerospace company's identity.
3. **Three of four onboarding options do nothing.** `robotics_oem` is `sortOrder` 1 — the
   first card a user sees — and has no dataset.

## Goals

- Each of the four industries provisions a coherent, industry-appropriate demo company.
- The tiers become genuinely industry-agnostic for everything a dataset needs to vary.
- Satellite's seeded output is **byte-for-byte unchanged** by the engine refactor.
- Adding a fifth industry costs data only, as the architecture claims.

## Non-goals

- No changes to how onboarding reaches the dataset (`applyDataset`, the `company-template`
  job, the failure marker) — that shipped in `60f41f251` / `19773927c` and is unaffected.
- No new database migration. All three `industry` rows already exist from
  `20260617100002_onboarding-and-backups.sql:25-35`.
- Not fixing the wider engine cleanup backlog (decoupling `workflow-definitions.ts` from
  satellite, making the purchasing-RFQ slice optional, widening `JournalLineSpec.accountClass`,
  turning silent skips into errors). Tracked in the research file; out of scope here.
- No UI change. The picker already filters on `datasetForIndustry`, so the three industries
  appear automatically once their datasets register.
- Not supporting non-USD currency or non-`EA` units of measure. All four industries sell
  discrete parts in USD; the ~30 hard-coded `"EA"` / `"USD"` / `"Part"` literals stay.

## The three industry stories

| key | industryId | Company | Story |
|-----|-----------|---------|-------|
| `robotics` | `robotics_oem` | Axis Robotics Inc. | 6-axis industrial arm OEM. `ROB-2000` arm → base / link / wrist / controller / harness / gripper → drive modules, PCBs, jaws → bought motors, encoders, bearings. Serial-tracked arms and motors, batch-tracked encoders. |
| `precision` | `precision_manufacturing` | Meridian Precision Works | Contract machine shop — CNC milling/turning plus sheet-metal fabrication. Customer-supplied prints, high job count, short lead times, outside processing (anodize, heat treat) as a first-class step. |
| `motor` | `automotive_precision` | Torque Dynamics LLC | Precision motor assemblies. Stator/rotor/housing/shaft sub-assemblies, batch-tracked windings and magnets, tighter inspection regime than the others. |

Each dataset defines its own plant address, timezone, shifts, warehouses, shelving and
supplier/customer roster. The `robotics` foundation and items slices are recovered from
`stash@{0}^3` (1,271 lines, written against the current contracts, needing one line deleted).

## Design

### Layer boundary (unchanged)

`data/<key>/` holds plain TypeScript literals; `tiers/` holds insertion logic and reads only
`ctx.dataset.<slice>`. All new content goes in `data/`.

### Engine changes — required blockers

| # | Change | Files |
|---|--------|-------|
| R1 | `DatasetKey` gains `"robotics" \| "precision" \| "motor"`; `DATASETS` gains the three entries | `types.ts:9`, `index.ts:26` |
| R2 | `ProductionData` gains `eventsJobKey` and `genealogyJobKey`; tier 6 reads those instead of the literal `"job:in-progress"` | `types.ts`, `06-production.ts:101,163` |
| R3 | `FoundationData` gains `defaultShippingMethod: string`; the four literal `"UPS Ground"` lookups read it | `types.ts`, `01-foundation.ts:253,309`, `04-sales.ts:31`, `05-purchasing.ts:15` |
| R4 | `FoundationData` gains `contractorAgency: { name; type; phone }`; `"Orbital Staffing"` moves into satellite's data | `types.ts`, `01-foundation.ts:366-372` |
| R5 | Shelving becomes dataset-declared (see below); `openingStock[].shelf` resolves against it | `types.ts`, `01-foundation.ts:113-142`, `03-inventory.ts:13,82` |
| R6 | Each `data/<key>/index.ts` sets `industryId` | new files |

### Engine changes — lifting satellite content out of tier 1

`FoundationData` gains the fields below; `tiers/01-foundation.ts` reads them instead of its
own literals. Satellite's data files gain the same values it currently hard-codes, so its
output is unchanged.

```typescript
export type ShiftSpec = {
  name: string;
  startTime: string;   // "HH:MM:SS", plant-local wall clock
  endTime: string;
  days: Array<"Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun">;
};

export type PlantSpec = {
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  timeZone: string;
};

export type WarehouseSpec = {
  name: string;
  requiresPick: boolean;
  requiresPutAway: boolean;
  requiresBin: boolean;
};

export type ShelfSpec = {
  /** The exact string openingStock[].shelf and inventoryCount reference. */
  name: string;
  warehouse: string;
  storageType: string;
};

export type PrinterRouteSpec = {
  name: string;
  format: string;
  printerUrl: string;
};
```

`FoundationData` additionally gains `shifts: ShiftSpec[]`, `plant: PlantSpec`,
`warehouses: WarehouseSpec[]`, `storageTypes: string[]`, `shelves: ShelfSpec[]`,
`printerRoute: PrinterRouteSpec | null`, `defaultShippingMethod: string`,
`contractorAgency: ContractorAgencySpec | null`.

Shelving replaces the engine's `for (let row = 1; row <= 3; row++)` aisle generator. Each
dataset lists its shelves explicitly, which makes the `openingStock[].shelf` contract
readable in one place instead of requiring the author to read tier source. `ShelfSpec.name`
is the join key; a name in `openingStock` with no matching `ShelfSpec` becomes a hard error
rather than today's silent drop.

`Dataset.companyName` is deleted — nothing reads it (`types.ts:681`; the dev CLI uses
`DEV_COMPANY_NAME`, onboarding uses the user's typed name). Removing it stops the next
dataset author supplying a value that does nothing.

### Data volume per dataset

Match satellite's verified baseline, so every list screen has rows and every detail screen
opens:

```
location 2, process 9, workCenter 7, customer 4, supplier 7, item 34,
makeMethod 27, methodMaterial 51, itemLedger 19, opportunity 11, salesRfq 2,
quote 3, salesOrder 10, shipment 1, salesInvoice 1, supplierInteraction 6,
purchasingRfq 1, supplierQuote 3, purchaseOrder 4, receipt 1, purchaseInvoice 1,
job 8, jobOperation 81, nonConformance 2, changeOrder 3, fixedAsset 4, workflow 7
```

Exact counts may differ where the industry story justifies it (a contract machine shop
plausibly runs more, smaller jobs), but no slice may be empty.

### Delivery sequence

- **Phase A** — engine changes R1–R6 + the tier-1 content lift + satellite's data updated to
  preserve its output + the `robotics` dataset. Shippable on its own, and proves the refactor
  against a real second dataset.
- **Phase B** — `precision` and `motor`, which are then data-only.

## Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fidelity per dataset | Full satellite parity, all 11 slices | User choice. Volume IS the coverage contract; a thin dataset leaves screens empty in a customer-facing demo. |
| Engine cleanup depth | Required blockers + lift tier-1 content | User choice. Without the lift, a robotics OEM and a motor shop both operate from a Houston aerospace address with a supplier called "Orbital Staffing". |
| Sequencing | Robotics first, then precision + motor | User choice. The stash supplies robotics' hardest half, and `robotics_oem` is the first card in onboarding. |
| Revive `stash@{0}` | Yes | 1,271 lines written against current contracts; one incompatible line (`foundation.ts:513` `structuralSteps`). ~99.9% salvageable, and it is the judgement-heavy half (coherent 4-level BOM, costing, lead times). |
| New migration | None | All three `industry` rows already exist. Only satellite needed one. |
| Shelving model | Dataset declares shelves explicitly | Today the engine generates names the dataset must guess; a mismatch silently drops all opening stock. Explicit list turns it into a hard error. |
| Job ref keys | `ProductionData.eventsJobKey` / `genealogyJobKey` | Narrower than making all ref keys dataset-driven, and fixes the only key that hard-throws. |
| `Dataset.companyName` | Delete | Dead field; nothing reads it. |
| UoM / currency / line type | Leave hard-coded | All four industries sell discrete parts in USD. Generalizing is unjustified work until a dataset needs `FT`/`LB` or another currency. |
| Verification | Per-dataset row-count baseline in `.ai/runs/` | `printSummary` is the documented check and only satellite has a baseline today. |

## Acceptance criteria

1. `pnpm db:seed:dev -- --email you@example.com --dataset satellite` prints row counts and
   structural sums **identical** to `.ai/runs/2026-08-13-seed-baseline.txt` and
   `.ai/runs/2026-08-13-seed-baseline-structural.txt`, proving the engine refactor changed
   nothing for the existing dataset.
2. `pnpm db:seed:dev -- --email you@example.com --dataset robotics` completes without error
   and prints row counts within ~10% of satellite's for every table, with no table at zero.
3. Same for `--dataset precision` and `--dataset motor`.
4. Seeding two different datasets into the same database succeeds — no duplicate-key failure,
   and `SELECT count(*), count(DISTINCT id) FROM "externalLink"` returns equal numbers.
5. For each dataset, `SELECT "totalDebits", "totalCredits" FROM "journalEntries"` returns
   equal values for every seeded entry.
6. For each dataset, opening stock is present: `itemLedger` row count is non-zero and every
   `openingStock[].shelf` resolved (no silent drops).
7. Each seeded company has a plant address, timezone, shift names and warehouse names drawn
   from its own dataset — no Houston/`America/Chicago`/`Orbital Staffing` in the robotics,
   precision or motor companies.
8. Onboarding's industry picker shows all four industries, and choosing each one provisions
   a company whose items match that industry.
9. `pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs --filter=erp`
   passes; `pnpm exec biome check` reports no errors; `pnpm --filter @carbon/workflows test`
   passes.
10. A row-count baseline file exists in `.ai/runs/` for each of the four datasets.

## Risks

- **The tier-1 refactor silently drops satellite rows.** Mitigated by acceptance criterion 1 —
  the baseline diff is the gate, and it must be run before the robotics data is written so a
  regression is attributable.
- **Volume of hand-authored data.** ~8,500 lines across three datasets, each internally
  consistent (BOM quantities, order totals, date ordering). Mitigated by sequencing and by the
  structural checks in criteria 4–6.
- **Date-offset discipline.** The recovered robotics slices carry no dates; the nine slices
  still to write for each dataset do. Every date must be a signed `DayOffset` — no JS `Date`,
  no `CURRENT_DATE`, and nothing enforces this automatically (`@carbon/checks` does not scan
  `packages/database/src/**`).

## Open questions

- [x] How complete should each dataset be? — **Answer:** Full satellite parity, all 11 slices.
      Volume is the coverage contract; empty screens undercut the demo.
- [x] How much engine cleanup before adding datasets? — **Answer:** Required blockers plus
      lifting shifts, plant address, warehouses, shelving and printer route out of
      `tiers/01-foundation.ts`. Otherwise three of four demo companies carry an aerospace
      company's identity.
- [x] Ship all three together or sequence? — **Answer:** Robotics first as Phase A together
      with the engine work, then precision and motor as Phase B.

## Changelog

- 2026-08-13 — Initial spec. Three open questions resolved with the user before writing
  (fidelity, engine-cleanup depth, sequencing); all three took the recommended option.
