// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. What the published item, quality and
// document operations refuse, read back from the rows they would have written.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as documents from "../../app/modules/documents/documents.server";
import * as items from "../../app/modules/items/items.server";
import * as itemsService from "../../app/modules/items/items.service";
import * as quality from "../../app/modules/quality/quality.server";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const prefix = `iqdguard-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  company: `${prefix}-company`,
  group: `${prefix}-group`,
  location: `${prefix}-location`,
  issueType: `${prefix}-issue-type`,
  openIssue: `${prefix}-issue-open`,
  draftNotice: `${prefix}-co-draft`,
  startedNotice: `${prefix}-co-start`,
  qualityDocument: `${prefix}-qd`,
  otherCompany: `${prefix}-other`,
  otherGroup: `${prefix}-other-group`,
  otherLocation: `${prefix}-other-location`,
  otherIssueType: `${prefix}-other-issue-type`,
  otherClosedIssue: `${prefix}-other-issue-closed`,
  otherItem: `${prefix}-other-item`
};

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

// The system, so the permission gate passes: what refuses is the operation.
const ctx = () =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: "system" },
    company: { id: ids.company, groupId: ids.group },
    caller: client!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

beforeAll(async () => {
  if (!client) return;
  db = await connectLocalTestDatabase();
  const createdBy = "system";
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    for (const [companyId, groupId, locationId] of [
      [ids.company, ids.group, ids.location],
      [ids.otherCompany, ids.otherGroup, ids.otherLocation]
    ] as const) {
      await trx
        .insertInto("companyGroup")
        .values({ id: groupId, name: groupId, createdBy })
        .execute();
      await trx
        .insertInto("company")
        .values({
          id: companyId,
          name: companyId,
          companyGroupId: groupId,
          baseCurrencyCode: "USD",
          timezone: "America/New_York"
        })
        .execute();
      await trx
        .insertInto("location")
        .values({
          id: locationId,
          name: "Plant",
          addressLine1: "1 Test Way",
          city: "Testville",
          postalCode: "00000",
          timezone: "America/New_York",
          companyId,
          createdBy
        })
        .execute();
      await trx
        .insertInto("unitOfMeasure")
        .values({ code: "EA", name: "Each", companyId, createdBy })
        .execute();
    }

    await trx
      .insertInto("nonConformanceType")
      .values([
        {
          id: ids.issueType,
          name: "Defect",
          companyId: ids.company,
          createdBy
        },
        {
          id: ids.otherIssueType,
          name: "Defect",
          companyId: ids.otherCompany,
          createdBy
        }
      ])
      .execute();
    const issue = (
      id: string,
      companyId: string,
      locationId: string,
      nonConformanceTypeId: string,
      status: "Registered" | "Closed"
    ) => ({
      id,
      nonConformanceId: id,
      name: "Scratched housing",
      source: "Internal" as const,
      status,
      openDate: "2026-01-01",
      locationId,
      nonConformanceTypeId,
      companyId,
      createdBy
    });
    await trx
      .insertInto("nonConformance")
      .values([
        issue(ids.openIssue, ids.company, ids.location, ids.issueType, "Registered"),
        issue(
          ids.otherClosedIssue,
          ids.otherCompany,
          ids.otherLocation,
          ids.otherIssueType,
          "Closed"
        )
      ])
      .execute();

    const notice = (id: string, status: "Draft" | "Start") => ({
      id,
      changeOrderId: id,
      name: "Notice",
      status,
      openDate: "2026-01-01",
      companyId: ids.company,
      createdBy
    });
    await trx
      .insertInto("changeOrder")
      .values([
        notice(ids.draftNotice, "Draft"),
        notice(ids.startedNotice, "Start")
      ])
      .execute();

    await trx
      .insertInto("qualityDocument")
      .values({
        id: ids.qualityDocument,
        name: "Torque procedure",
        version: 1,
        companyId: ids.company,
        createdBy
      })
      .execute();

    await trx
      .insertInto("item")
      .values({
        id: ids.otherItem,
        readableId: `${prefix}-OTHER`,
        name: "Another company's part",
        type: "Part",
        itemTrackingType: "Inventory",
        unitOfMeasureCode: "EA",
        companyId: ids.otherCompany,
        createdBy
      })
      .execute();
  });
});

afterAll(async () => {
  if (!client) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    for (const [companyId, groupId] of [
      [ids.company, ids.group],
      [ids.otherCompany, ids.otherGroup]
    ]) {
      await trx.deleteFrom("company").where("id", "=", companyId).execute();
      await trx.deleteFrom("companyGroup").where("id", "=", groupId).execute();
      await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
        trx
      );
      await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
        trx
      );
    }
  });
  await db.destroy();
}, 60_000);

const noticeStatus = async (id: string) =>
  (
    await db
      .selectFrom("changeOrder")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
  ).status;

const issueStatus = async (id: string) =>
  (
    await db
      .selectFrom("nonConformance")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
  ).status;

describeLocal("change notice stages", () => {
  it("passes a refused transition through as a rule", async () => {
    const result = await items.setChangeNoticeStatus(ctx(), {
      id: ids.draftNotice,
      fromStatus: "Draft",
      status: "Engineering Complete"
    });

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Cannot change status from Draft to Engineering Complete"
    });
    expect(await noticeStatus(ids.draftNotice)).toBe("Draft");
  });

  it("passes a stale page through as a conflict", async () => {
    const result = await items.setChangeNoticeStatus(ctx(), {
      id: ids.startedNotice,
      fromStatus: "Draft",
      status: "Start"
    });

    expect(result.error).toMatchObject({
      category: "conflict",
      message: itemsService.changeNoticeUpdatedElsewhere
    });
  });

  it("releases only through applyChangeNotice", async () => {
    const release = await items.setChangeNoticeStatus(ctx(), {
      id: ids.startedNotice,
      fromStatus: "Implementation",
      status: "Done"
    });
    expect(release.error?.category).toBe("conflict");

    const bare = await itemsService.updateChangeNoticeStatus(client!, {
      id: ids.startedNotice,
      companyId: ids.company,
      fromStatus: "Start",
      toStatus: "Done",
      updatedBy: "system"
    });
    expect(bare.error).toMatchObject({ code: "CARBON_RULE" });
    expect(await noticeStatus(ids.startedNotice)).toBe("Start");
  });
});

describeLocal("updates never write a status", () => {
  it("leaves a change notice's stage alone", async () => {
    const result = await items.updateChangeNotice(ctx(), {
      id: ids.startedNotice,
      name: "Renamed",
      status: "Done"
    } as never);

    expect(result.error).toBeNull();
    const row = await db
      .selectFrom("changeOrder")
      .select(["name", "status"])
      .where("id", "=", ids.startedNotice)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "Renamed", status: "Start" });
  });

  it("leaves an issue's status alone", async () => {
    const result = await quality.updateIssue(ctx(), {
      id: ids.openIssue,
      name: "Scratched cover",
      status: "Closed"
    } as never);

    expect(result.error).toBeNull();
    expect(await issueStatus(ids.openIssue)).toBe("Registered");
  });

  it("creates and updates a quality document as Draft", async () => {
    const created = await quality.createQualityDocument(ctx(), {
      name: "Cleaning procedure",
      version: 0,
      status: "Active"
    } as never);
    expect(created.error).toBeNull();
    const createdRow = await db
      .selectFrom("qualityDocument")
      .select("status")
      .where("name", "=", "Cleaning procedure")
      .where("companyId", "=", ids.company)
      .executeTakeFirstOrThrow();
    expect(createdRow.status).toBe("Draft");

    const updated = await quality.updateQualityDocument(ctx(), {
      id: ids.qualityDocument,
      name: "Torque procedure",
      version: 2,
      status: "Active"
    } as never);
    expect(updated.error).toBeNull();
    const updatedRow = await db
      .selectFrom("qualityDocument")
      .select(["status", "version"])
      .where("id", "=", ids.qualityDocument)
      .executeTakeFirstOrThrow();
    expect(updatedRow).toEqual({ status: "Draft", version: 2 });
  });
});

describeLocal("another company's records", () => {
  it("does not reopen another company's closed issue", async () => {
    const result = await quality.setIssueStatus(ctx(), {
      id: ids.otherClosedIssue,
      status: "Registered"
    });

    expect(result.error?.category).toBe("notFound");
    expect(await issueStatus(ids.otherClosedIssue)).toBe("Closed");
  });

  it("does not associate another company's item with an issue", async () => {
    const result = await quality.createIssueAssociation(ctx(), {
      nonConformanceId: ids.openIssue,
      type: "items",
      id: ids.otherItem
    });

    expect(result.error?.category).toBe("notFound");
    const linked = await db
      .selectFrom("nonConformanceItem")
      .select("id")
      .where("nonConformanceId", "=", ids.openIssue)
      .execute();
    expect(linked).toEqual([]);
  });
});

describeLocal("storage paths", () => {
  const foreign = [
    `${prefix}-other/documents/drawing.pdf`,
    `${ids.company}/../${prefix}-other/drawing.pdf`
  ];

  it.each(foreign)("refuses a document at %s", async (path) => {
    const result = await documents.createDocument(ctx(), {
      name: "Drawing",
      readGroups: ["everyone"],
      writeGroups: ["everyone"],
      path
    });
    expect(result.error?.category).toBe("validation");
  });

  it.each(foreign)("refuses an extraction of %s", async (storagePath) => {
    const result = await documents.insertDocumentExtraction(ctx(), {
      storagePath,
      documentType: "purchaseInvoice",
      sourceDocument: "Purchase Invoice"
    });
    expect(result.error?.category).toBe("validation");
    const rows = await db
      .selectFrom("documentExtraction")
      .select("id")
      .where("companyId", "=", ids.company)
      .execute();
    expect(rows).toEqual([]);
  });

  it.each(foreign)("refuses an inspection drawing at %s", async (path) => {
    const result = await quality.saveInspectionDocument(ctx(), {
      inspectionDocumentId: `${prefix}-plan`,
      pdfUrl: `/file/preview/private/${path}`
    });
    expect(result.error?.category).toBe("validation");
  });
});

describeLocal("material taxonomy", () => {
  it("writes a finish whatever audit fields the caller sends", async () => {
    const result = await items.upsertMaterialFinish(ctx(), {
      materialSubstanceId: "steel",
      name: `${prefix} brushed`,
      createdBy: "system",
      updatedBy: "system"
    });

    expect(result.error).toBeNull();
    const row = await db
      .selectFrom("materialFinish")
      .select("companyId")
      .where("name", "=", `${prefix} brushed`)
      .executeTakeFirstOrThrow();
    expect(row.companyId).toBe(ids.company);
  });
});
