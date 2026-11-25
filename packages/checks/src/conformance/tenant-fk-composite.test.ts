// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadSqlFiles, migrationsDir, repoRoot } from "../sources/migrations";
import {
  tenantFkComposite,
  tenantKeysFromMigrations
} from "./tenant-fk-composite";

const NEW = "20261201000000_new.sql";

/** The keys of the real migrations: which parents can take a composite FK today. */
const REPO = tenantFkComposite(
  tenantKeysFromMigrations(loadSqlFiles(migrationsDir(repoRoot())))
);

/** A parent keyed ("id", "companyId") and one keyed by id alone. */
const PARENTS = tenantKeysFromMigrations([
  {
    file: "20260101000000_parents.sql",
    contents: [
      'CREATE TABLE "workCenter" (',
      '  "id" TEXT NOT NULL,',
      '  "companyId" TEXT NOT NULL,',
      '  CONSTRAINT "workCenter_pkey" PRIMARY KEY ("id", "companyId")',
      ");",
      'CREATE TABLE "journal" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'CREATE TABLE "integration" ("id" TEXT PRIMARY KEY);',
      'CREATE TABLE "customer" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'ALTER TABLE "customer" ADD CONSTRAINT "customer_id_companyId_key" UNIQUE ("id", "companyId");',
      'CREATE TABLE "purchaseOrder" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'CREATE UNIQUE INDEX "purchaseOrder_id_companyId_key" ON "purchaseOrder" ("id", "companyId");',
      'CREATE TABLE "salesOrder" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'CREATE UNIQUE INDEX "salesOrder_open_key" ON "salesOrder" ("id", "companyId") WHERE "status" = \'Open\';',
      'CREATE TABLE "payment" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'CREATE TABLE "userNote" ("id" TEXT PRIMARY KEY, "customerId" TEXT);'
    ].join("\n")
  }
]);
const FIXTURE = tenantFkComposite(PARENTS);

const findings = (
  sql: string,
  check = FIXTURE,
  file = NEW
): { line: number; column: string }[] =>
  check.scan(file, sql).map(({ line, message }) => ({
    line,
    column: message.split(" ")[0] ?? ""
  }));

describe("tenantFkComposite", () => {
  // 20261013030022_oee-provider.sql lines 91-116, from `git show 3fc6be2f2d^`.
  const OEE_DEVICE_BEFORE_3FC6BE2F2D = `CREATE TABLE IF NOT EXISTS "workCenterDevice" (
  "id" TEXT NOT NULL DEFAULT id('wcd'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "integration" TEXT NOT NULL REFERENCES "integration"("id"),
  "externalDeviceId" TEXT NOT NULL,
  "externalSiteId" TEXT,
  "siteTimezone" TEXT,
  "deviceName" TEXT NOT NULL,
  "currentState" "machineState",
  "currentStateAt" TIMESTAMP WITH TIME ZONE,
  "appliedThrough" TIMESTAMP WITH TIME ZONE,
  "lastEventAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "lastManualChangeAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncError" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "workCenterDevice_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "workCenterDevice_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterDevice_workCenter_key" UNIQUE ("workCenterId", "companyId"),
  CONSTRAINT "workCenterDevice_device_key" UNIQUE ("integration", "externalDeviceId", "companyId")
);`;

  it("flags workCenterDevice.workCenterId from before 3fc6be2f2d", () => {
    expect(findings(OEE_DEVICE_BEFORE_3FC6BE2F2D, REPO)).toEqual([
      { line: 4, column: "workCenterDevice.workCenterId" }
    ]);
  });

  it("passes the 3fc6be2f2d fix (20261013191915_oee-tenancy-and-retention.sql lines 7-12)", () => {
    const fix = `ALTER TABLE "workCenterDevice"
  DROP CONSTRAINT IF EXISTS "workCenterDevice_workCenterId_fkey";
ALTER TABLE "workCenterDevice"
  ADD CONSTRAINT "workCenterDevice_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;`;
    expect(findings(fix, REPO)).toEqual([]);
  });

  it("flags machineStateChange and unattributedMachineTime from before 8a5281c6ff", () => {
    // 20261013030022_oee-provider.sql lines 122-126 and 144-147, from `git show 8a5281c6ff^`.
    const before = `CREATE TABLE IF NOT EXISTS "machineStateChange" (
  "id" TEXT NOT NULL DEFAULT id('msc'),
  "companyId" TEXT NOT NULL,
  "workCenterDeviceId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "externalEventId" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "unattributedMachineTime" (
  "id" TEXT NOT NULL DEFAULT id('umt'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "startTime" TIMESTAMP WITH TIME ZONE NOT NULL
);`;
    expect(findings(before, REPO)).toEqual([
      { line: 5, column: "machineStateChange.workCenterId" },
      { line: 11, column: "unattributedMachineTime.workCenterId" }
    ]);
  });

  it("passes the 8a5281c6ff fix (20261013201722_oee-company-scoped-work-center.sql lines 5-16)", () => {
    const fix = `ALTER TABLE "machineStateChange"
  DROP CONSTRAINT IF EXISTS "machineStateChange_workCenterId_fkey";
ALTER TABLE "machineStateChange"
  ADD CONSTRAINT "machineStateChange_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;

ALTER TABLE "unattributedMachineTime"
  DROP CONSTRAINT IF EXISTS "unattributedMachineTime_workCenterId_fkey";
ALTER TABLE "unattributedMachineTime"
  ADD CONSTRAINT "unattributedMachineTime_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;`;
    expect(findings(fix, REPO)).toEqual([]);
  });

  it("flags payment.purchaseOrderId in a DO block from before aa781984a4", () => {
    // 20261105213627_supplier-prepayments.sql lines 9-18, from `git show aa781984a4^`.
    const before = `ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;

DO $prepay$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_purchaseOrder_fkey') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_purchaseOrder_fkey"
      FOREIGN KEY ("purchaseOrderId")
      REFERENCES "purchaseOrder"("id") ON DELETE SET NULL;
  END IF;
END $prepay$;`;
    expect(findings(before, REPO)).toEqual([
      { line: 8, column: "payment.purchaseOrderId" }
    ]);
  });

  it("passes the aa781984a4 fix (20261105213627_supplier-prepayments.sql lines 9-18)", () => {
    const fix = `ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "purchaseOrder_id_companyId_key"
  ON "purchaseOrder" ("id", "companyId");

ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_purchaseOrder_fkey";
ALTER TABLE "payment" ADD CONSTRAINT "payment_purchaseOrder_fkey"
  FOREIGN KEY ("purchaseOrderId", "companyId")
  REFERENCES "purchaseOrder"("id", "companyId")
  ON DELETE SET NULL ("purchaseOrderId");`;
    expect(findings(fix, REPO)).toEqual([]);
  });

  it("flags customerAsset.customerId from before ba1db4283e", () => {
    // 20261021002400_field-service.sql lines 7-29, from `git show ba1db4283e^`.
    const before = `CREATE TABLE IF NOT EXISTS "customerAsset" (
  "id" TEXT NOT NULL DEFAULT id('cas'),
  "companyId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id"),
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "customerLocationId" TEXT REFERENCES "customerLocation"("id") ON DELETE SET NULL,
  "status" "customerAssetStatus" NOT NULL DEFAULT 'In Service',
  "shippedDate" DATE,
  "laborWarrantyEndDate" DATE,
  "partsWarrantyEndDate" DATE,
  "shipmentId" TEXT REFERENCES "shipment"("id") ON DELETE SET NULL,  -- the shipment that created or last moved it
  "source" TEXT NOT NULL DEFAULT 'Shipment' CHECK ("source" IN ('Shipment', 'Manual')),
  "notes" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerAsset_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerAsset_trackedEntity_key" UNIQUE ("trackedEntityId", "companyId"),
  CONSTRAINT "customerAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);`;
    expect(findings(before, REPO)).toEqual([
      { line: 6, column: "customerAsset.customerId" }
    ]);
  });

  it("passes the ba1db4283e fix (20261104215223_composite-customer-fks-service-projects.sql lines 7-10)", () => {
    const fix = `ALTER TABLE "customerAsset"
  DROP CONSTRAINT "customerAsset_customerId_fkey",
  ADD CONSTRAINT "customerAsset_customerId_fkey"
    FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId");`;
    expect(findings(fix, REPO)).toEqual([]);
  });

  it("names the composite FOREIGN KEY in its message", () => {
    const [v] = FIXTURE.scan(
      NEW,
      'CREATE TABLE "x" ("id" TEXT, "companyId" TEXT NOT NULL, "customerId" TEXT REFERENCES "customer"("id"));'
    );
    expect(v?.message).toContain(
      'FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId")'
    );
    expect(v?.snippet).toBe(
      'CREATE TABLE "x" ("id" TEXT, "companyId" TEXT NOT NULL, "customerId" TEXT REFERENCES "customer"("id")'
    );
  });

  it("flags a parent keyed by a UNIQUE constraint or a unique index, and a reference with no column list", () => {
    const sql = [
      'CREATE TABLE "x" (',
      '  "companyId" TEXT NOT NULL,',
      '  "customerId" TEXT REFERENCES "customer",',
      '  "purchaseOrderId" TEXT REFERENCES public."purchaseOrder"("id")',
      ");"
    ].join("\n");
    expect(findings(sql)).toEqual([
      { line: 3, column: "x.customerId" },
      { line: 4, column: "x.purchaseOrderId" }
    ]);
  });

  it("flags an ADD COLUMN on a table that gained companyId in an earlier migration", () => {
    expect(
      findings(
        'ALTER TABLE "payment" ADD COLUMN "salesCustomerId" TEXT REFERENCES "customer"("id") ON DELETE SET NULL;'
      )
    ).toEqual([{ line: 1, column: "payment.salesCustomerId" }]);
  });

  it("counts a parent keyed in the same migration", () => {
    const sql = [
      'CREATE TABLE "lease" ("id" TEXT, "companyId" TEXT, PRIMARY KEY ("companyId", "id"));',
      'CREATE TABLE "leaseLine" ("companyId" TEXT, "leaseId" TEXT REFERENCES "lease"("id"));'
    ].join("\n");
    expect(findings(sql)).toEqual([{ line: 2, column: "leaseLine.leaseId" }]);
  });

  it("leaves parents keyed by id alone, global tables and partial unique indexes alone", () => {
    const sql = [
      'CREATE TABLE "x" (',
      '  "companyId" TEXT NOT NULL REFERENCES "company"("id"),',
      '  "journalId" TEXT REFERENCES "journal"("id"),',
      '  "integration" TEXT REFERENCES "integration"("id"),',
      '  "salesOrderId" TEXT REFERENCES "salesOrder"("id")',
      ");"
    ].join("\n");
    expect(findings(sql)).toEqual([]);
  });

  it("leaves a referencing table without companyId alone", () => {
    expect(
      findings(
        'ALTER TABLE "userNote" ADD CONSTRAINT "userNote_customer_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id");'
      )
    ).toEqual([]);
  });

  it("leaves a reference to a column other than id alone", () => {
    expect(
      findings(
        'CREATE TABLE "x" ("companyId" TEXT, "code" TEXT REFERENCES "customer"("customerId"));'
      )
    ).toEqual([]);
  });

  it("ignores REFERENCES in a comment", () => {
    expect(
      findings(
        '-- was "customerId" TEXT REFERENCES "customer"("id")\nCREATE TABLE "x" ("companyId" TEXT);'
      )
    ).toEqual([]);
  });

  it("does not apply to migrations on main before the check", () => {
    expect(
      findings(
        OEE_DEVICE_BEFORE_3FC6BE2F2D,
        REPO,
        "20261013030022_oee-provider.sql"
      )
    ).toEqual([]);
  });
});
