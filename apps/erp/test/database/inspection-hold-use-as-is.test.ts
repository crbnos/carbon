// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Use As Is on a receipt lot's NCR sends those parts to Put Away, and the
// receipt waits for them; every other disposition leaves them out.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { createServiceContext } from "@carbon/api/service-fn.server";
import { dispositionInspection } from "@carbon/database/quality";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeStockTransfer,
  getReceiptPutAwayLines,
  insertReceiptPutAway,
  postReceipt,
  postStockTransfer
} from "../../app/modules/inventory/inventory.service";
import * as quality from "../../app/modules/quality/quality.server";
import {
  closeIssue,
  openInspectionNcr,
  splitIssueItem
} from "../../app/modules/quality/quality.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

describe.skipIf(!hasLocalDatabase)("Use As Is goes to Put Away", () => {
  let f: Fixture;
  let rejectedUnit: string;
  let shelf: string;
  const unitOf = (key: string) => `${f.prefix}-qc-${key}`;
  const UNIT_KEYS = [
    "keep",
    "rework",
    "part",
    "acc",
    "spl",
    "ma",
    "mb",
    "pick",
    "leg",
    "again"
  ];

  beforeAll(async () => {
    f = await alwaysPostFixture();
    rejectedUnit = `${f.prefix}-mrb`;
    shelf = `${f.prefix}-shelf`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values(
          [rejectedUnit, ...UNIT_KEYS.map(unitOf)].map((id) => ({
            id,
            name: id,
            locationId: f.locationId,
            nettable: false,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      await trx
        .insertInto("storageUnit")
        .values({
          id: shelf,
          name: shelf,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("pickMethod")
        .values({
          itemId: f.partId,
          locationId: f.locationId,
          defaultStorageUnitId: shelf,
          companyId: f.companyId,
          createdBy: USER
        })
        .onConflict((oc) =>
          oc
            .columns(["itemId", "locationId"])
            .doUpdateSet({ defaultStorageUnitId: shelf })
        )
        .execute();
      await trx
        .updateTable("location")
        .set({
          inspectionStorageUnitId: unitOf("keep"),
          rejectedStorageUnitId: rejectedUnit
        })
        .where("id", "=", f.locationId)
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .insertInto("sequence")
        .values([
          {
            table: "inspection",
            name: "Inspection",
            prefix: "INS-",
            companyId: f.companyId
          },
          {
            table: "nonConformance",
            name: "Issue",
            prefix: "NCR",
            companyId: f.companyId
          },
          {
            table: "stockTransfer",
            name: "Stock Transfer",
            prefix: "ST-",
            companyId: f.companyId
          }
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .insertInto("nonConformanceType")
        .values({
          name: `${f.prefix}-type`,
          companyId: f.companyId,
          createdBy: USER
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const document = await trx
        .insertInto("inspectionDocument")
        .values({ partId: f.partId, companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("itemInspectionDocumentAssignment")
        .values({
          itemId: f.partId,
          usage: "Receipt",
          inspectionDocumentId: document.id,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
  });

  afterAll(async () => {
    if (!f) return;
    await seed(f, async (trx) => {
      await trx
        .deleteFrom("inspection")
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .deleteFrom("itemInspectionDocumentAssignment")
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .deleteFrom("inspectionDocument")
        .where("companyId", "=", f.companyId)
        .execute();
    });
    await f.cleanup();
  });

  const withGuard = async <T>(run: () => Promise<T>): Promise<T> => {
    await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
      f.db
    );
    try {
      return await run();
    } finally {
      await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
        f.db
      );
    }
  };

  const client = hasLocalDatabase ? localServiceRoleClient() : null;
  const stackContext = () =>
    createServiceContext({
      actor: { type: "system", onBehalfOf: USER },
      company: { id: f.companyId, groupId: f.groupId },
      caller: client!,
      system: () => client!,
      pg: () => f.db,
      kv: () => {
        throw new Error("No operation here reads the cache");
      }
    });

  const receiveInto = async (key: string) => {
    const receiptId = await draftReceiptFromPurchaseOrder(f, key);
    await seed(f, (trx) =>
      trx
        .updateTable("receiptLine")
        .set({ storageUnitId: unitOf(key) })
        .where("receiptId", "=", receiptId)
        .where("companyId", "=", f.companyId)
        .execute()
    );
    const posted = await invokePosting(
      handlesOf(f.ctx),
      "post-receipt",
      { type: "post", receiptId },
      postReceipt
    );
    expect(posted.error).toBeNull();
    const lot = await f.db
      .selectFrom("inspection")
      .select("id")
      .where("sourceDocumentId", "=", receiptId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    return { receiptId, lotId: lot.id, key };
  };
  const unitKeyOf = (received: { key: string }) => received.key;

  const dispose = (
    issueId: string,
    disposition: "Use As Is" | "Rework" | "Scrap",
    rowId?: string
  ) =>
    seed(f, (trx) =>
      trx
        .updateTable("nonConformanceItem")
        .set({ disposition })
        .where("nonConformanceId", "=", issueId)
        .$if(!!rowId, (qb) => qb.where("id", "=", rowId!))
        .where("companyId", "=", f.companyId)
        .execute()
    );

  const close = async (issueId: string) => {
    const closed = await withGuard(() =>
      closeIssue(client!, f.db, {
        nonConformanceId: issueId,
        companyId: f.companyId,
        userId: USER
      })
    );
    expect(closed.error).toBeNull();
  };

  const putAwayLines = async (receiptId: string) =>
    (await getReceiptPutAwayLines(f.db, f.companyId, receiptId)).map(
      (line) => ({
        from: line.fromStorageUnitId,
        to: line.toStorageUnitId,
        quantity: line.quantity
      })
    );

  const receiptStatus = async (receiptId: string) =>
    (
      await f.db
        .selectFrom("receipt")
        .select("inspectionStatus")
        .where("id", "=", receiptId)
        .executeTakeFirstOrThrow()
    ).inspectionStatus;

  it.skipIf(!client)(
    "Use As Is on a rejected lot puts it away, and the receipt waits for it",
    async () => {
      const { receiptId, lotId } = await receiveInto("keep");
      const rejected = await withGuard(() =>
        quality.rejectInspection(stackContext(), {
          id: lotId,
          createNcr: true,
          reason: "Transit damage"
        })
      );
      expect(rejected.error).toBeNull();
      const issueId = rejected.data!.issueId!;
      expect(await putAwayLines(receiptId)).toEqual([]);
      expect(await receiptStatus(receiptId)).toBe("Inspection Failed");

      await dispose(issueId, "Use As Is");
      await close(issueId);
      // The reject wrote the lot off from its unit; Use As Is put it back there.
      expect(await putAwayLines(receiptId)).toEqual([
        { from: unitOf("keep"), to: shelf, quantity: 10 }
      ]);
      expect(await receiptStatus(receiptId)).toBe("Inspection Failed");

      const created = await insertReceiptPutAway(f.db, {
        companyId: f.companyId,
        userId: USER,
        receiptId
      });
      if (!("created" in created)) throw new Error(created.refusal);
      const line = await f.db
        .selectFrom("stockTransferLine")
        .select(["id", "quantity"])
        .where("stockTransferId", "=", created.created.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(line.quantity)).toBe(10);
      // The open transfer speaks for the whole lot.
      expect(await putAwayLines(receiptId)).toEqual([]);

      const pick = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-stock-transfer",
          {
            type: "inventory",
            stockTransferId: created.created.id,
            stockTransferLineId: line.id,
            quantity: 10,
            locationId: f.locationId
          },
          postStockTransfer
        )
      );
      expect(pick.error).toBeNull();
      const transfer = await f.db
        .selectFrom("stockTransfer")
        .select("status")
        .where("id", "=", created.created.id)
        .executeTakeFirstOrThrow();
      if (transfer.status !== "Completed") {
        expect(
          await completeStockTransfer(f.db, {
            id: created.created.id,
            companyId: f.companyId,
            userId: USER
          })
        ).toBeNull();
      }
      expect(await putAwayLines(receiptId)).toEqual([]);
      expect(await receiptStatus(receiptId)).toBe("Put Away");
    },
    120_000
  );

  it.skipIf(!client)(
    "Rework on a rejected lot leaves it out of Put Away",
    async () => {
      const { receiptId, lotId } = await receiveInto("rework");
      const rejected = await withGuard(() =>
        quality.rejectInspection(stackContext(), {
          id: lotId,
          createNcr: true,
          reason: "Transit damage"
        })
      );
      expect(rejected.error).toBeNull();
      const issueId = rejected.data!.issueId!;
      await dispose(issueId, "Rework");
      await close(issueId);
      expect(await putAwayLines(receiptId)).toEqual([]);
      expect(await receiptStatus(receiptId)).toBe("Inspection Failed");
    },
    120_000
  );

  it.skipIf(!client)(
    "Use As Is on a Partial lot's remainder puts it away from the rejected unit",
    async () => {
      const { receiptId, lotId } = await receiveInto("part");
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: lotId,
          acceptedQuantity: 6,
          createNcr: true
        })
      );
      expect(partial.error).toBeNull();
      const issueId = partial.data!.issueId!;
      expect(await putAwayLines(receiptId)).toEqual([
        { from: unitOf("part"), to: shelf, quantity: 6 }
      ]);

      await dispose(issueId, "Use As Is");
      await close(issueId);
      expect(await putAwayLines(receiptId)).toEqual([
        { from: unitOf("part"), to: shelf, quantity: 6 },
        { from: rejectedUnit, to: shelf, quantity: 4 }
      ]);
      expect(await receiptStatus(receiptId)).toBe("Partially Passed");
    },
    120_000
  );

  it.skipIf(!client)(
    "two rejected lots on one NCR: only the lot Use As Is restored into goes to Put Away",
    async () => {
      const [first, second] = [
        await receiveInto("ma"),
        await receiveInto("mb")
      ].sort((a, b) => a.lotId.localeCompare(b.lotId));
      // The lot with the lower id is short in its unit, so its reject writes
      // off 4 and the other's 10. Closing restores the larger write-off first.
      await seed(f, (trx) =>
        trx
          .insertInto("itemLedger")
          .values({
            postingDate: "2026-11-16",
            entryType: "Negative Adjmt.",
            itemId: f.partId,
            locationId: f.locationId,
            storageUnitId: unitOf(unitKeyOf(first!)),
            trackedEntityId: null,
            quantity: -6,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      const rejected = await withGuard(() =>
        quality.rejectInspection(stackContext(), {
          id: first!.lotId,
          createNcr: true,
          reason: "Transit damage"
        })
      );
      expect(rejected.error).toBeNull();
      const issueId = rejected.data!.issueId!;
      const other = await withGuard(() =>
        quality.rejectInspection(stackContext(), {
          id: second!.lotId,
          createNcr: false,
          reason: "Transit damage"
        })
      );
      expect(other.error).toBeNull();
      await seed(f, async (trx) => {
        await trx
          .insertInto("nonConformanceInspection")
          .values({
            nonConformanceId: issueId,
            inspectionId: second!.lotId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Use As Is", quantity: 10 })
          .where("nonConformanceId", "=", issueId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .insertInto("nonConformanceItem")
          .values({
            nonConformanceId: issueId,
            itemId: f.partId,
            disposition: "Rework",
            quantity: 4,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      await close(issueId);

      // The Use As Is 10 came back into the second lot's unit, the Rework 4
      // into the first's: only the second receipt has stock to put away.
      expect(await putAwayLines(second!.receiptId)).toEqual([
        { from: unitOf(unitKeyOf(second!)), to: shelf, quantity: 10 }
      ]);
      expect(await putAwayLines(first!.receiptId)).toEqual([]);
      expect(await receiptStatus(second!.receiptId)).toBe("Inspection Failed");
      expect(await receiptStatus(first!.receiptId)).toBe("Inspection Failed");
    },
    120_000
  );

  // A serial line on the receipt of `key`, its units On Hold in the line's
  // unit with a receipt row each, and an open lot over them. The receipt's
  // untracked lot is cancelled, so this lot is the receipt's only one.
  const serialLot = async (
    key: string,
    units: string[],
    options: { keepOtherLots?: boolean } = {}
  ) => {
    const item = `${f.prefix}-serial-${key}`;
    const line = `${f.prefix}-serial-line-${key}`;
    const lot = `${f.prefix}-serial-lot-${key}`;
    const { receiptId } = await receiveInto(key);
    await seed(f, async (trx) => {
      if (!options.keepOtherLots) {
        await trx
          .updateTable("inspection")
          .set({ status: "Cancelled" })
          .where("sourceDocumentId", "=", receiptId)
          .where("companyId", "=", f.companyId)
          .execute();
      }
      await trx
        .insertInto("item")
        .values({
          id: item,
          readableId: `${f.prefix}-SERIAL-${key}`,
          name: "serial",
          type: "Part",
          itemTrackingType: "Serial",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("pickMethod")
        .values({
          itemId: item,
          locationId: f.locationId,
          defaultStorageUnitId: shelf,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("receiptLine")
        .values({
          id: line,
          receiptId,
          itemId: item,
          locationId: f.locationId,
          storageUnitId: unitOf(key),
          orderQuantity: units.length,
          receivedQuantity: units.length,
          unitOfMeasure: "EA",
          unitPrice: 0,
          requiresInspection: true,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("trackedEntity")
        .values(
          units.map((id) => ({
            id,
            itemId: item,
            quantity: 1,
            status: "On Hold" as const,
            sourceDocument: "Receipt",
            sourceDocumentId: receiptId,
            attributes: JSON.stringify({ "Receipt Line": line }),
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      await trx
        .insertInto("itemLedger")
        .values(
          units.map((id) => ({
            postingDate: "2026-11-16",
            entryType: "Positive Adjmt." as const,
            documentType: "Purchase Receipt" as const,
            documentId: receiptId,
            itemId: item,
            locationId: f.locationId,
            storageUnitId: unitOf(key),
            trackedEntityId: id,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      await trx
        .insertInto("inspection")
        .values({
          id: lot,
          inspectionId: `${f.prefix}-INS-SN-${key}`,
          itemId: item,
          lotSize: units.length,
          samplingStandard: "ANSI_Z1_4",
          samplingPlanType: "All",
          sampleSize: units.length,
          acceptanceNumber: 0,
          rejectionNumber: 1,
          sourceDocument: "Receipt",
          sourceDocumentId: receiptId,
          sourceDocumentLineId: line,
          storageUnitId: unitOf(key),
          status: "In Progress",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return { receiptId, lot, line, item };
  };

  const sample = (lot: string, units: Record<string, "Passed" | "Failed">) =>
    seed(f, (trx) =>
      trx
        .insertInto("inspectionSample")
        .values(
          Object.entries(units).map(([trackedEntityId, status]) => ({
            inspectionId: lot,
            trackedEntityId,
            status,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute()
    );

  it.skipIf(!client)(
    "a unit an Accept rejected goes to Put Away once its NCR keeps it",
    async () => {
      const [passed, failed] = ["a1", "a2"].map((k) => `${f.prefix}-sn-${k}`);
      const { receiptId, lot, line, item } = await serialLot("acc", [
        passed!,
        failed!
      ]);
      await sample(lot, { [passed!]: "Passed", [failed!]: "Failed" });
      const accepted = await withGuard(() =>
        dispositionInspection(f.db, {
          id: lot,
          decision: "Accept",
          companyId: f.companyId,
          dispositionedBy: USER,
          requireSource: "Receipt"
        })
      );
      expect(accepted.error).toBeNull();
      expect(await putAwayLines(receiptId)).toEqual([
        { from: unitOf("acc"), to: shelf, quantity: 1 }
      ]);

      // The passed unit goes to the shelf: the receipt is put away.
      await seed(f, async (trx) => {
        await trx
          .insertInto("itemLedger")
          .values(
            [
              { storageUnitId: unitOf("acc"), quantity: -1 },
              { storageUnitId: shelf, quantity: 1 }
            ].map((row) => ({
              ...row,
              postingDate: "2026-11-16",
              entryType: "Transfer" as const,
              documentType: "Direct Transfer" as const,
              itemId: item,
              locationId: f.locationId,
              trackedEntityId: passed,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
        const transfer = await trx
          .insertInto("stockTransfer")
          .values({
            stockTransferId: `${f.prefix}-ST-acc`,
            locationId: f.locationId,
            receiptId,
            status: "Completed",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("stockTransferLine")
          .values({
            stockTransferId: transfer.id,
            receiptLineId: line,
            itemId: item,
            fromStorageUnitId: unitOf("acc"),
            toStorageUnitId: shelf,
            quantity: 1,
            pickedQuantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      await sql`SELECT public.refresh_receipt_inspection_status(${receiptId})`.execute(
        f.db
      );
      expect(await receiptStatus(receiptId)).toBe("Put Away");
      expect(await putAwayLines(receiptId)).toEqual([]);

      const opened = await withGuard(() =>
        openInspectionNcr(stackContext(), {
          id: lot,
          title: "Failed units",
          outcome: "Lot accepted",
          quantity: 1,
          trackedEntityIds: [failed!]
        })
      );
      if (!("issueId" in opened)) throw opened;
      await dispose(opened.issueId, "Use As Is");
      await close(opened.issueId);

      // The receipt waits for the kept unit, still in its received unit.
      expect(await receiptStatus(receiptId)).toBe("Inspection Passed");
      expect(await putAwayLines(receiptId)).toEqual([
        { from: unitOf("acc"), to: shelf, quantity: 1 }
      ]);
    },
    120_000
  );

  it.skipIf(!client)(
    "of a serial Partial's rejected units, only the one kept goes to Put Away",
    async () => {
      const [passed, kept, scrapped] = ["s1", "s2", "s3"].map(
        (k) => `${f.prefix}-sn-${k}`
      );
      const { receiptId, lot } = await serialLot("spl", [
        passed!,
        kept!,
        scrapped!
      ]);
      await sample(lot, {
        [passed!]: "Passed",
        [kept!]: "Failed",
        [scrapped!]: "Failed"
      });
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: lot,
          createNcr: true
        })
      );
      expect(partial.error).toBeNull();
      const issueId = partial.data!.issueId!;
      expect(await putAwayLines(receiptId)).toEqual([
        { from: unitOf("spl"), to: shelf, quantity: 1 }
      ]);

      const row = await f.db
        .selectFrom("nonConformanceItem")
        .select("id")
        .where("nonConformanceId", "=", issueId)
        .executeTakeFirstOrThrow();
      const split = await withGuard(() =>
        splitIssueItem(f.db, {
          id: row.id,
          companyId: f.companyId,
          userId: USER,
          entityAssignments: [{ trackedEntityId: scrapped!, quantity: 1 }]
        })
      );
      expect(split.error).toBeNull();
      await dispose(issueId, "Use As Is", row.id);
      await dispose(issueId, "Scrap", split.data!.id);
      await close(issueId);

      // The kept unit is where the Partial moved it: the rejected unit.
      expect(await putAwayLines(receiptId)).toEqual([
        { from: unitOf("spl"), to: shelf, quantity: 1 },
        { from: rejectedUnit, to: shelf, quantity: 1 }
      ]);
      expect(await receiptStatus(receiptId)).toBe("Partially Passed");
      const statuses = await f.db
        .selectFrom("trackedEntity")
        .select(["id", "status"])
        .where("id", "in", [passed!, kept!, scrapped!])
        .orderBy("id")
        .execute();
      expect(statuses).toEqual([
        { id: passed, status: "Available" },
        { id: kept, status: "Available" },
        { id: scrapped, status: "Rejected" }
      ]);
    },
    120_000
  );

  it.skipIf(!client)(
    "a Put Away line takes only the units it offers, not a Rework unit beside them",
    async () => {
      const [passed, kept, reworked] = ["p1", "p2", "p3"].map(
        (k) => `${f.prefix}-sn-${k}`
      );
      const { receiptId, lot } = await serialLot("pick", [
        passed!,
        kept!,
        reworked!
      ]);
      await sample(lot, {
        [passed!]: "Passed",
        [kept!]: "Failed",
        [reworked!]: "Failed"
      });
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: lot,
          createNcr: true
        })
      );
      expect(partial.error).toBeNull();
      const issueId = partial.data!.issueId!;
      const row = await f.db
        .selectFrom("nonConformanceItem")
        .select("id")
        .where("nonConformanceId", "=", issueId)
        .executeTakeFirstOrThrow();
      const split = await withGuard(() =>
        splitIssueItem(f.db, {
          id: row.id,
          companyId: f.companyId,
          userId: USER,
          entityAssignments: [{ trackedEntityId: reworked!, quantity: 1 }]
        })
      );
      expect(split.error).toBeNull();
      await dispose(issueId, "Use As Is", row.id);
      await dispose(issueId, "Rework", split.data!.id);
      await close(issueId);

      const created = await insertReceiptPutAway(f.db, {
        companyId: f.companyId,
        userId: USER,
        receiptId
      });
      if (!("created" in created)) throw new Error(created.refusal);
      const lines = await f.db
        .selectFrom("stockTransferLine")
        .select(["id", "fromStorageUnitId"])
        .where("stockTransferId", "=", created.created.id)
        .where("companyId", "=", f.companyId)
        .execute();
      const fromRejected = lines.find(
        (line) => line.fromStorageUnitId === rejectedUnit
      )!;
      const fromReceived = lines.find(
        (line) => line.fromStorageUnitId === unitOf("pick")
      )!;
      const pick = (lineId: string, trackedEntityId: string) =>
        withGuard(() =>
          invokePosting(
            handlesOf(f.ctx),
            "post-stock-transfer",
            {
              type: "serial",
              stockTransferId: created.created.id,
              stockTransferLineId: lineId,
              trackedEntityId,
              locationId: f.locationId
            },
            postStockTransfer
          )
        );

      // The Rework unit sits in the rejected unit beside the kept one.
      expect((await pick(fromRejected.id, reworked!)).error?.message).toMatch(
        /not part of this Put Away/
      );
      // A unit the lot passed is not taken from the rejected unit's line.
      expect((await pick(fromRejected.id, passed!)).error).not.toBeNull();
      expect((await pick(fromRejected.id, kept!)).error).toBeNull();
      expect((await pick(fromReceived.id, passed!)).error).toBeNull();

      const at = async (trackedEntityId: string) =>
        (
          await f.db
            .selectFrom("itemLedger")
            .select(["storageUnitId", sql<number>`SUM("quantity")`.as("quantity")])
            .where("trackedEntityId", "=", trackedEntityId)
            .where("companyId", "=", f.companyId)
            .groupBy("storageUnitId")
            .having(sql`SUM("quantity")`, ">", 0)
            .execute()
        ).map((row) => row.storageUnitId);
      expect(await at(kept!)).toEqual([shelf]);
      expect(await at(passed!)).toEqual([shelf]);
      expect(await at(reworked!)).toEqual([rejectedUnit]);
      expect(await receiptStatus(receiptId)).toBe("Put Away");
    },
    120_000
  );

  // A receipt already put away (its serial lot accepted and moved to the
  // shelf) beside an untracked lot rejected onto an NCR.
  const putAwayBesideRejected = async (key: string) => {
    const unit = `${f.prefix}-sn-${key}`;
    const { receiptId, lot, line, item } = await serialLot(key, [unit], {
      keepOtherLots: true
    });
    const untracked = await f.db
      .selectFrom("inspection")
      .select("id")
      .where("sourceDocumentId", "=", receiptId)
      .where("id", "!=", lot)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const rejected = await withGuard(() =>
      quality.rejectInspection(stackContext(), {
        id: untracked.id,
        createNcr: true,
        reason: "Transit damage"
      })
    );
    expect(rejected.error).toBeNull();

    await sample(lot, { [unit]: "Passed" });
    const accepted = await withGuard(() =>
      dispositionInspection(f.db, {
        id: lot,
        decision: "Accept",
        companyId: f.companyId,
        dispositionedBy: USER,
        requireSource: "Receipt"
      })
    );
    expect(accepted.error).toBeNull();
    await seed(f, async (trx) => {
      await trx
        .insertInto("itemLedger")
        .values(
          [
            { storageUnitId: unitOf(key), quantity: -1 },
            { storageUnitId: shelf, quantity: 1 }
          ].map((row) => ({
            ...row,
            postingDate: "2026-11-16",
            entryType: "Transfer" as const,
            documentType: "Direct Transfer" as const,
            itemId: item,
            locationId: f.locationId,
            trackedEntityId: unit,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      const transfer = await trx
        .insertInto("stockTransfer")
        .values({
          stockTransferId: `${f.prefix}-ST-${key}`,
          locationId: f.locationId,
          receiptId,
          status: "Completed",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("stockTransferLine")
        .values({
          stockTransferId: transfer.id,
          receiptLineId: line,
          itemId: item,
          fromStorageUnitId: unitOf(key),
          toStorageUnitId: shelf,
          quantity: 1,
          pickedQuantity: 1,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      // A non-nettable unit, as the roll-up reads a unit for a lot that
      // records none.
      await trx
        .updateTable("storageUnit")
        .set({ effectiveNettable: false })
        .where("id", "=", unitOf(key))
        .where("companyId", "=", f.companyId)
        .execute();
    });
    await sql`SELECT public.refresh_receipt_inspection_status(${receiptId})`.execute(
      f.db
    );
    expect(await receiptStatus(receiptId)).toBe("Put Away");
    return {
      receiptId,
      issueId: rejected.data!.issueId!,
      untrackedLotId: untracked.id
    };
  };

  it.skipIf(!client)(
    "Use As Is on a rejected lot reopens a receipt already put away",
    async () => {
      const { receiptId, issueId } = await putAwayBesideRejected("again");
      await dispose(issueId, "Use As Is");
      await close(issueId);
      // The close refreshes the receipt after its restore is written.
      expect(await receiptStatus(receiptId)).toBe("Partially Passed");
      expect(await putAwayLines(receiptId)).toEqual([
        { from: unitOf("again"), to: shelf, quantity: 10 }
      ]);
    },
    120_000
  );

  it.skipIf(!client)(
    "a lot from before the hold keeps its Use As Is part out of the receipt's status",
    async () => {
      const { receiptId, issueId, untrackedLotId } =
        await putAwayBesideRejected("leg");
      // The rejected lot as a lot from before the hold: no unit of its own.
      await seed(f, (trx) =>
        trx
          .updateTable("inspection")
          .set({ storageUnitId: null })
          .where("id", "=", untrackedLotId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      await dispose(issueId, "Use As Is");
      await close(issueId);
      // Put Away never offers such a lot, so the receipt does not wait for it.
      expect(await putAwayLines(receiptId)).toEqual([]);
      expect(await receiptStatus(receiptId)).toBe("Put Away");
    },
    120_000
  );
});
