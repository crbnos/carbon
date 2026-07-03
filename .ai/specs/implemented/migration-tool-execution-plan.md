# Migration Tool Execution Plan

## Overview

- **Starting point:** committed CSV import foundation (`fixture-schema.ts`, fixture pack, `import-runner.ts`, contract tests)
- **Scope:** deterministic migration runner, source-template profiles, dry-run validation, verification report, fixture-backed tests
- **Out of scope for this plan:** UI, browser automation, actual Supabase storage upload, real DB execution, customer-specific AI skill packaging
- **Estimated time:** 15 tasks × ~3 minutes = ~45 minutes implementation time
- **Branch:** `feat/migration-tool`

## Current foundation

The previous phase already provides:

- `packages/database/supabase/functions/import-csv/import-runner.ts` with parsing/mapping helpers
- `packages/database/supabase/functions/import-csv/fixture-schema.ts` with table/reference/expected schemas
- `packages/database/supabase/functions/import-csv/fixtures/golden/v1/` golden CSV pack
- `packages/database/supabase/functions/import-csv/fixtures/edge-cases/` focused edge cases
- `apps/erp/app/modules/shared/imports.contract.test.ts` keeping app/edge import contracts aligned

## Dependency graph

1. Tasks 1-3 define source profiles.
2. Tasks 4-8 define dry-run runner.
3. Tasks 9-10 add fixture-backed report validation.
4. Tasks 11-12 add edge-case fixture coverage through runner.
5. Tasks 13-14 verify and commit.

No database migrations are needed. Do not rebuild the database.

---

## Task 1: Add source-profile test for canonical Carbon CSVs

**Files:**
- Create: `packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts`

**Steps:**

1. Create `migration-source-profiles.test.ts` with this red test:

   ```ts
   import assert from "node:assert/strict";
   import test from "node:test";
   import { carbonCanonicalProfile, tableExecutionOrder } from "./migration-source-profiles.ts";

   test("carbon canonical profile covers supported tables in execution order", () => {
     assert.deepEqual(tableExecutionOrder, [
       "customer",
       "supplier",
       "customerContact",
       "supplierContact",
       "part",
       "material",
       "tool",
       "fixture",
       "consumable",
       "workCenter",
       "process",
     ]);

     assert.deepEqual(
       carbonCanonicalProfile.tables.map((table) => table.table),
       tableExecutionOrder
     );
   });

   test("carbon canonical profile maps material contract fields by name", () => {
     const material = carbonCanonicalProfile.tables.find((table) => table.table === "material");

     assert.ok(material);
     assert.equal(material.fileName, "material.csv");
     assert.equal(material.columnMappings.finish, "finish");
     assert.equal(material.columnMappings.grade, "grade");
     assert.equal(material.columnMappings.dimensions, "dimensions");
     assert.equal("finishId" in material.columnMappings, false);
     assert.equal("gradeId" in material.columnMappings, false);
     assert.equal("dimensionId" in material.columnMappings, false);
   });
   ```

2. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts
   ```

3. Expected RED:

   ```text
   Cannot find module './migration-source-profiles.ts'
   ```

---

## Task 2: Create canonical source-profile module

**Files:**
- Create: `packages/database/supabase/functions/import-csv/migration-source-profiles.ts`

**Steps:**

1. Create `migration-source-profiles.ts`:

   ```ts
   import type { z } from "zod";
   import type { ColumnMappings, EnumMappings } from "./import-runner.ts";
   import { supportedFixtureTableSchema } from "./fixture-schema.ts";

   export type MigrationTable = z.infer<typeof supportedFixtureTableSchema>;

   export type SourceTableProfile = {
     table: MigrationTable;
     fileName: string;
     columnMappings: ColumnMappings;
     enumMappings?: EnumMappings;
   };

   export type SourceProfile = {
     id: string;
     name: string;
     tables: SourceTableProfile[];
   };

   export const tableExecutionOrder: MigrationTable[] = [
     "customer",
     "supplier",
     "customerContact",
     "supplierContact",
     "part",
     "material",
     "tool",
     "fixture",
     "consumable",
     "workCenter",
     "process",
   ];

   function sameNameMappings(fields: string[]): ColumnMappings {
     return Object.fromEntries(fields.map((field) => [field, field]));
   }

   export const carbonCanonicalProfile: SourceProfile = {
     id: "carbon-canonical-v1",
     name: "Carbon Canonical CSV v1",
     tables: [
       {
         table: "customer",
         fileName: "customer.csv",
         columnMappings: sameNameMappings([
           "id",
           "name",
           "accountManagerId",
           "customerStatusId",
           "customerTypeId",
           "phone",
           "fax",
           "taxId",
           "currencyCode",
           "website",
           "locationName",
           "addressLine1",
           "addressLine2",
           "city",
           "state",
           "postalCode",
           "countryCode",
           "paymentTermId",
         ]),
       },
       {
         table: "supplier",
         fileName: "supplier.csv",
         columnMappings: sameNameMappings([
           "id",
           "name",
           "accountManagerId",
           "supplierStatus",
           "supplierTypeId",
           "phone",
           "fax",
           "taxId",
           "currencyCode",
           "website",
           "locationName",
           "addressLine1",
           "addressLine2",
           "city",
           "state",
           "postalCode",
           "countryCode",
           "paymentTermId",
           "shippingMethodId",
           "incoterm",
           "incotermLocation",
         ]),
       },
       {
         table: "customerContact",
         fileName: "customerContact.csv",
         columnMappings: sameNameMappings([
           "id",
           "companyId",
           "firstName",
           "lastName",
           "email",
           "title",
           "mobilePhone",
           "workPhone",
           "homePhone",
           "fax",
           "notes",
         ]),
       },
       {
         table: "supplierContact",
         fileName: "supplierContact.csv",
         columnMappings: sameNameMappings([
           "id",
           "companyId",
           "firstName",
           "lastName",
           "email",
           "title",
           "mobilePhone",
           "workPhone",
           "homePhone",
           "fax",
           "notes",
         ]),
       },
       ...["part", "tool", "fixture", "consumable"].map((table) => ({
         table: table as MigrationTable,
         fileName: `${table}.csv`,
         columnMappings: sameNameMappings([
           "id",
           "readableId",
           "revision",
           "name",
           "active",
           "replenishmentSystem",
           "defaultMethodType",
           "itemTrackingType",
           "unitOfMeasureCode",
           "supplierId",
           "supplierPartId",
           "supplierUnitOfMeasureCode",
           "minimumOrderQuantity",
           "orderMultiple",
           "conversionFactor",
           "unitPrice",
           "leadTime",
         ]),
       })),
       {
         table: "material",
         fileName: "material.csv",
         columnMappings: sameNameMappings([
           "id",
           "readableId",
           "revision",
           "name",
           "active",
           "materialSubstanceId",
           "materialFormId",
           "defaultMethodType",
           "itemTrackingType",
           "finish",
           "grade",
           "dimensions",
           "unitOfMeasureCode",
           "supplierId",
           "supplierPartId",
           "supplierUnitOfMeasureCode",
           "minimumOrderQuantity",
           "orderMultiple",
           "conversionFactor",
           "unitPrice",
           "leadTime",
         ]),
       },
       {
         table: "workCenter",
         fileName: "workCenter.csv",
         columnMappings: sameNameMappings([
           "id",
           "name",
           "description",
           "defaultStandardFactor",
           "laborRate",
           "machineRate",
           "overheadRate",
           "locationId",
         ]),
       },
       {
         table: "process",
         fileName: "process.csv",
         columnMappings: sameNameMappings([
           "id",
           "name",
           "processType",
           "defaultStandardFactor",
           "completeAllOnScan",
         ]),
       },
     ],
   };
   ```

2. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts
   ```

3. Expected GREEN:

   ```text
   pass 2
   fail 0
   ```

---

## Task 3: Add table-order parity test against fixture manifest

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts`

**Steps:**

1. Add imports at top:

   ```ts
   import { readFileSync } from "node:fs";
   import { dirname, resolve } from "node:path";
   import { fileURLToPath } from "node:url";
   import { goldenManifestSchema } from "./fixture-schema.ts";
   ```

2. Add helpers after imports:

   ```ts
   const here = dirname(fileURLToPath(import.meta.url));
   const goldenRoot = resolve(here, "fixtures/golden/v1");

   function readJson(path: string) {
     return JSON.parse(readFileSync(path, "utf8"));
   }
   ```

3. Add test:

   ```ts
   test("carbon canonical profile covers exactly the golden manifest tables", () => {
     const manifest = goldenManifestSchema.parse(
       readJson(resolve(goldenRoot, "manifest.json"))
     );

     assert.deepEqual(
       [...carbonCanonicalProfile.tables.map((table) => table.table)].sort(),
       [...manifest.tables].sort()
     );
   });
   ```

4. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts
   ```

5. Expected GREEN:

   ```text
   pass 3
   fail 0
   ```

---

## Task 4: Add migration-runner dry-run red test

**Files:**
- Create: `packages/database/supabase/functions/import-csv/migration-runner.test.ts`

**Steps:**

1. Create `migration-runner.test.ts`:

   ```ts
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";
   import { dirname, resolve } from "node:path";
   import test from "node:test";
   import { fileURLToPath } from "node:url";
   import { buildDryRunReport } from "./migration-runner.ts";
   import { carbonCanonicalProfile } from "./migration-source-profiles.ts";

   const here = dirname(fileURLToPath(import.meta.url));
   const goldenRoot = resolve(here, "fixtures/golden/v1");

   function csvFile(fileName: string) {
     return readFileSync(resolve(goldenRoot, fileName), "utf8");
   }

   test("buildDryRunReport counts rows for every canonical golden file", () => {
     const report = buildDryRunReport({
       scenario: "golden-happy-v1",
       profile: carbonCanonicalProfile,
       files: Object.fromEntries(
         carbonCanonicalProfile.tables.map((table) => [table.fileName, csvFile(table.fileName)])
       ),
     });

     assert.equal(report.scenario, "golden-happy-v1");
     assert.equal(report.status, "pass");
     assert.equal(report.tables.length, carbonCanonicalProfile.tables.length);
     assert.equal(report.errors.length, 0);
     assert.ok(report.totalRows > 0);
   });
   ```

2. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

3. Expected RED:

   ```text
   Cannot find module './migration-runner.ts'
   ```

---

## Task 5: Create basic migration dry-run runner

**Files:**
- Create: `packages/database/supabase/functions/import-csv/migration-runner.ts`

**Steps:**

1. Create `migration-runner.ts`:

   ```ts
   import { parsePermissiveCsv, prepareMappedRecords } from "./import-runner.ts";
   import type { SourceProfile } from "./migration-source-profiles.ts";

   export type MigrationDryRunTable = {
     table: string;
     fileName: string;
     rowCount: number;
     mappedRowCount: number;
     errors: Array<{ row: number; reason: string }>;
     warnings: string[];
   };

   export type MigrationDryRunReport = {
     scenario: string;
     status: "pass" | "fail";
     totalRows: number;
     tables: MigrationDryRunTable[];
     errors: Array<{ table: string; row: number; reason: string }>;
     warnings: Array<{ table: string; message: string }>;
   };

   export function buildDryRunReport(args: {
     scenario: string;
     profile: SourceProfile;
     files: Record<string, string>;
   }): MigrationDryRunReport {
     const tables = args.profile.tables.map((tableProfile) => {
       const csvText = args.files[tableProfile.fileName] ?? "";
       const parsedRows = parsePermissiveCsv(csvText);
       const mappedRows = prepareMappedRecords(
         parsedRows,
         tableProfile.columnMappings,
         tableProfile.enumMappings
       );

       return {
         table: tableProfile.table,
         fileName: tableProfile.fileName,
         rowCount: parsedRows.length,
         mappedRowCount: mappedRows.length,
         errors: [],
         warnings: csvText ? [] : [`Missing file ${tableProfile.fileName}`],
       };
     });

     const errors = tables.flatMap((table) =>
       table.errors.map((error) => ({ table: table.table, ...error }))
     );
     const warnings = tables.flatMap((table) =>
       table.warnings.map((message) => ({ table: table.table, message }))
     );

     return {
       scenario: args.scenario,
       status: errors.length > 0 ? "fail" : "pass",
       totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0),
       tables,
       errors,
       warnings,
     };
   }
   ```

2. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

3. Expected GREEN:

   ```text
   pass 1
   fail 0
   ```

---

## Task 6: Add required-field dry-run validation test

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-runner.test.ts`
- Modify: `packages/database/supabase/functions/import-csv/migration-source-profiles.ts`

**Steps:**

1. Add test to `migration-runner.test.ts`:

   ```ts
   test("buildDryRunReport fails when required mapped values are blank", () => {
     const report = buildDryRunReport({
       scenario: "missing-required-customer-name",
       profile: {
         id: "test-profile",
         name: "Test Profile",
         tables: [
           {
             table: "customer",
             fileName: "customer.csv",
             columnMappings: { id: "id", name: "name" },
             requiredFields: ["id", "name"],
           },
         ],
       },
       files: {
         "customer.csv": "id,name\nCUST-1,\n",
       },
     });

     assert.equal(report.status, "fail");
     assert.deepEqual(report.errors, [
       { table: "customer", row: 0, reason: "Missing required field: name" },
     ]);
   });
   ```

2. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

3. Expected RED:

   ```text
   Missing required field: name
   ```

---

## Task 7: Implement required-field validation

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-source-profiles.ts`
- Modify: `packages/database/supabase/functions/import-csv/migration-runner.ts`

**Steps:**

1. In `SourceTableProfile`, add:

   ```ts
   requiredFields?: string[];
   ```

2. In `migration-runner.ts`, add helper above `buildDryRunReport`:

   ```ts
   function validateRequiredFields(
     rows: Record<string, string>[],
     requiredFields: string[] = []
   ): Array<{ row: number; reason: string }> {
     return rows.flatMap((row, rowIndex) =>
       requiredFields
         .filter((field) => !row[field]?.trim())
         .map((field) => ({
           row: rowIndex,
           reason: `Missing required field: ${field}`,
         }))
     );
   }
   ```

3. Replace `errors: []` in table result with:

   ```ts
   errors: validateRequiredFields(mappedRows, tableProfile.requiredFields),
   ```

4. Add `requiredFields` to canonical profile table entries:

   ```ts
   customer: ["id", "name"]
   supplier: ["id", "name"]
   customerContact: ["id", "companyId", "email"]
   supplierContact: ["id", "companyId", "email"]
   part/tool/fixture/consumable/material: ["id", "readableId", "name"]
   workCenter: ["id", "name", "description", "locationId"]
   process: ["id", "name", "processType"]
   ```

5. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts
   ```

6. Expected GREEN:

   ```text
   fail 0
   ```

---

## Task 8: Add duplicate ID dry-run validation test

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-runner.test.ts`

**Steps:**

1. Add test:

   ```ts
   test("buildDryRunReport fails duplicate ids within one source file", () => {
     const report = buildDryRunReport({
       scenario: "duplicate-customer-id",
       profile: {
         id: "test-profile",
         name: "Test Profile",
         tables: [
           {
             table: "customer",
             fileName: "customer.csv",
             columnMappings: { id: "id", name: "name" },
             requiredFields: ["id", "name"],
             uniqueFields: ["id"],
           },
         ],
       },
       files: {
         "customer.csv": "id,name\nCUST-1,Acme\nCUST-1,Acme Duplicate\n",
       },
     });

     assert.equal(report.status, "fail");
     assert.deepEqual(report.errors, [
       { table: "customer", row: 1, reason: "Duplicate value for id: CUST-1" },
     ]);
   });
   ```

2. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

3. Expected RED: duplicate error absent.

---

## Task 9: Implement duplicate ID validation

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-source-profiles.ts`
- Modify: `packages/database/supabase/functions/import-csv/migration-runner.ts`

**Steps:**

1. In `SourceTableProfile`, add:

   ```ts
   uniqueFields?: string[];
   ```

2. Add helper to `migration-runner.ts`:

   ```ts
   function validateUniqueFields(
     rows: Record<string, string>[],
     uniqueFields: string[] = []
   ): Array<{ row: number; reason: string }> {
     const errors: Array<{ row: number; reason: string }> = [];

     for (const field of uniqueFields) {
       const seen = new Set<string>();
       for (const [rowIndex, row] of rows.entries()) {
         const value = row[field];
         if (!value) continue;
         if (seen.has(value)) {
           errors.push({ row: rowIndex, reason: `Duplicate value for ${field}: ${value}` });
         } else {
           seen.add(value);
         }
       }
     }

     return errors;
   }
   ```

3. Replace table `errors` assignment with:

   ```ts
   const errors = [
     ...validateRequiredFields(mappedRows, tableProfile.requiredFields),
     ...validateUniqueFields(mappedRows, tableProfile.uniqueFields),
   ];
   ```

   Then use `errors` in the returned table object.

4. Add `uniqueFields: ["id"]` to every canonical profile table entry.

5. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts
   ```

6. Expected GREEN:

   ```text
   fail 0
   ```

---

## Task 10: Add import request planning test

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-runner.test.ts`

**Steps:**

1. Add test:

   ```ts
   test("buildDryRunReport includes import requests in execution order", () => {
     const report = buildDryRunReport({
       scenario: "single-customer",
       profile: {
         id: "test-profile",
         name: "Test Profile",
         tables: [
           {
             table: "customer",
             fileName: "customer.csv",
             columnMappings: { id: "id", name: "name" },
             requiredFields: ["id", "name"],
             uniqueFields: ["id"],
           },
         ],
       },
       files: {
         "customer.csv": "id,name\nCUST-1,Acme\n",
       },
       companyId: "company-1",
       userId: "user-1",
       filePathPrefix: "migration/golden",
     });

     assert.deepEqual(report.importRequests, [
       {
         table: "customer",
         filePath: "migration/golden/customer.csv",
         columnMappings: { id: "id", name: "name" },
         enumMappings: undefined,
         companyId: "company-1",
         userId: "user-1",
       },
     ]);
   });
   ```

2. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

3. Expected RED: `importRequests` missing.

---

## Task 11: Implement import request planning

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-runner.ts`

**Steps:**

1. Add type:

   ```ts
   export type MigrationImportRequest = {
     table: string;
     filePath: string;
     columnMappings: Record<string, string>;
     enumMappings?: Record<string, Record<string, string>>;
     companyId: string;
     userId: string;
   };
   ```

2. Add fields to `MigrationDryRunReport`:

   ```ts
   importRequests: MigrationImportRequest[];
   ```

3. Add optional args to `buildDryRunReport`:

   ```ts
   companyId?: string;
   userId?: string;
   filePathPrefix?: string;
   ```

4. Build requests before return:

   ```ts
   const importRequests = args.profile.tables.map((tableProfile) => ({
     table: tableProfile.table,
     filePath: [args.filePathPrefix, tableProfile.fileName].filter(Boolean).join("/"),
     columnMappings: tableProfile.columnMappings,
     enumMappings: tableProfile.enumMappings,
     companyId: args.companyId ?? "",
     userId: args.userId ?? "",
   }));
   ```

5. Include `importRequests` in returned report.

6. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

7. Expected GREEN:

   ```text
   fail 0
   ```

---

## Task 12: Add verification summary comparison test

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-runner.test.ts`

**Steps:**

1. Add imports:

   ```ts
   import { expectedScenarioSchema } from "./fixture-schema.ts";
   ```

2. Add helper:

   ```ts
   function jsonFile(fileName: string) {
     return JSON.parse(readFileSync(resolve(goldenRoot, fileName), "utf8"));
   }
   ```

3. Add test:

   ```ts
   test("buildDryRunReport can be compared to golden expected summary row counts", () => {
     const expected = expectedScenarioSchema.parse(jsonFile("expected/summary.json"));
     const report = buildDryRunReport({
       scenario: "golden-happy-v1",
       profile: carbonCanonicalProfile,
       files: Object.fromEntries(
         carbonCanonicalProfile.tables.map((table) => [table.fileName, csvFile(table.fileName)])
       ),
     });

     assert.equal(report.status, "pass");
     assert.equal(report.totalRows, expected.summary.inserted + expected.summary.updated + expected.summary.skipped);
   });
   ```

4. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

5. Expected GREEN. If it fails, update fixture expected summary only if the fixture file count proves the expected summary is wrong.

---

## Task 13: Add edge-case runner coverage

**Files:**
- Modify: `packages/database/supabase/functions/import-csv/migration-runner.test.ts`

**Steps:**

1. Add helper:

   ```ts
   function edgeCsv(path: string) {
     return readFileSync(resolve(here, "fixtures/edge-cases", path, "input.csv"), "utf8");
   }
   ```

2. Add tests:

   ```ts
   test("buildDryRunReport catches missing work center location", () => {
     const report = buildDryRunReport({
       scenario: "workCenter/missing-location",
       profile: {
         id: "edge-profile",
         name: "Edge Profile",
         tables: [
           {
             table: "workCenter",
             fileName: "input.csv",
             columnMappings: {
               id: "id",
               name: "name",
               description: "description",
               locationId: "locationId",
             },
             requiredFields: ["id", "name", "description", "locationId"],
             uniqueFields: ["id"],
           },
         ],
       },
       files: { "input.csv": edgeCsv("workCenter/missing-location") },
     });

     assert.equal(report.status, "fail");
     assert.deepEqual(report.errors, [
       { table: "workCenter", row: 0, reason: "Missing required field: locationId" },
     ]);
   });

   test("buildDryRunReport accepts supplier blank IDs without duplicate failures", () => {
     const report = buildDryRunReport({
       scenario: "supplier/blank-id-dedup",
       profile: {
         id: "edge-profile",
         name: "Edge Profile",
         tables: [
           {
             table: "supplier",
             fileName: "input.csv",
             columnMappings: { id: "id", name: "name" },
             requiredFields: ["name"],
             uniqueFields: ["id"],
           },
         ],
       },
       files: { "input.csv": edgeCsv("supplier/blank-id-dedup") },
     });

     assert.equal(report.status, "pass");
   });
   ```

3. Run:

   ```bash
   node --test packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

4. Expected GREEN.

---

## Task 14: Run full import foundation verification

**Files:**
- No file changes

**Steps:**

1. Run Node import tests:

   ```bash
   node --test \
     packages/database/supabase/functions/import-csv/fixture-schema.test.ts \
     packages/database/supabase/functions/import-csv/edge-case-fixtures.test.ts \
     packages/database/supabase/functions/import-csv/import-runner.test.ts \
     packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts \
     packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

2. Expected:

   ```text
   fail 0
   ```

3. Run ERP import contract tests:

   ```bash
   pnpm --filter erp exec vitest run 'app/modules/shared/imports.contract.test.ts' 'app/routes/x+/shared+/import.$tableId.test.ts'
   ```

4. Expected:

   ```text
   Test Files  2 passed (2)
   Tests  9 passed (9)
   ```

5. Check diff:

   ```bash
   git diff --check
   git status --short
   ```

6. Expected:

   ```text
   # git diff --check has no output
   # git status lists only migration-runner/source-profile files
   ```

---

## Task 15: Commit migration runner foundation

**Files:**
- New:
  - `packages/database/supabase/functions/import-csv/migration-source-profiles.ts`
  - `packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts`
  - `packages/database/supabase/functions/import-csv/migration-runner.ts`
  - `packages/database/supabase/functions/import-csv/migration-runner.test.ts`

**Steps:**

1. Stage files:

   ```bash
   git add \
     packages/database/supabase/functions/import-csv/migration-source-profiles.ts \
     packages/database/supabase/functions/import-csv/migration-source-profiles.test.ts \
     packages/database/supabase/functions/import-csv/migration-runner.ts \
     packages/database/supabase/functions/import-csv/migration-runner.test.ts
   ```

2. Commit:

   ```bash
   git commit -m "Add migration dry-run runner foundation" -m "Add canonical source profiles, deterministic dry-run validation, import request planning, and fixture-backed migration runner tests.\n\nCo-Authored-By: Claude <noreply@anthropic.com>"
   ```

3. Because project rules require cache updates after commit, update `llm/cache/csv-import-system.md` with:

   ```markdown
   - `migration-source-profiles.ts` defines the canonical Carbon source profile and table execution order for migration planning.
   - `migration-runner.ts` builds deterministic dry-run reports, validates required/unique fields, and plans import-csv requests without executing database writes.
   ```

4. Commit cache:

   ```bash
   git add llm/cache/csv-import-system.md
   git commit -m "Update migration runner cache notes" -m "Document the committed dry-run runner and source profile foundation.\n\nCo-Authored-By: Claude <noreply@anthropic.com>"
   ```

---

## Review checklist

- [ ] Tasks are ordered TDD-first.
- [ ] No database rebuild is required.
- [ ] No runtime DB writes are introduced.
- [ ] Runner stays deterministic and pure.
- [ ] Existing fixture pack remains source of truth.
- [ ] Source profile layer can later support NetSuite/Epicor/SAP-style variants.
- [ ] Import requests are planned but not executed in this phase.
- [ ] Verification commands include existing foundation tests.
