// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database and PostgREST; skipped without them.

// Closing an NCR writes off an untracked Scrap or Return to Supplier row (not
// from an inspection) from the bins that hold the stock: held units first,
// then the other bins, fullest first. Before, it always booked "no storage
// unit", which went negative while the real bin kept its stock.

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { closeIssue } from "../../app/modules/quality/quality.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

type Disposition = "Scrap" | "Return to Supplier";

describe.skipIf(!hasLocalDatabase)("NCR scrap source bins", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;
  let quarantine: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-a`;
    binB = `${f.prefix}-b`;
    quarantine = `${f.prefix}-q`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values([
          ...[binA, binB].map((id) => ({
            id,
            name: id,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })),
          {
            id: quarantine,
            name: quarantine,
            locationId: f.locationId,
            nettable: false,
            effectiveNettable: false,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      await trx
        .insertInto("nonConformanceType")
        .values({
          name: `${f.prefix}-type`,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  // The hold guard and the ledger handlers run, as in the app.
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

  /** An untracked part with the given on-hand per bin (null: no bin). */
  async function itemWithStock(
    key: string,
    stock: { storageUnitId: string | null; quantity: number }[]
  ) {
    const itemId = `${f.prefix}-item-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: itemId.toUpperCase(),
          name: key,
          type: "Part",
          itemTrackingType: "Inventory",
          unitOfMeasureCode: "EA",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ costingMethod: "Standard", unitCost: 10 })
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .execute();
      if (stock.length > 0) {
        await trx
          .insertInto("itemLedger")
          .values(
            stock.map((row) => ({
              itemId,
              quantity: row.quantity,
              locationId: f.locationId,
              storageUnitId: row.storageUnitId,
              entryType: "Positive Adjmt." as const,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
      }
    });
    return itemId;
  }

  /** An NCR at the fixture's location, not from an inspection. */
  async function issueWith(
    key: string,
    rows: { itemId: string; disposition: Disposition; quantity: number }[]
  ) {
    const issueId = `${f.prefix}-ncr-${key}`;
    await seed(f, async (trx) => {
      const type = await trx
        .selectFrom("nonConformanceType")
        .select("id")
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("nonConformance")
        .values({
          id: issueId,
          nonConformanceId: `${f.prefix}-NCR-${key}`.toUpperCase(),
          name: key,
          source: "Internal",
          locationId: f.locationId,
          nonConformanceTypeId: type.id,
          openDate: f.today,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("nonConformanceItem")
        .values(
          rows.map((row) => ({
            nonConformanceId: issueId,
            ...row,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    return issueId;
  }

  const close = (client: Parameters<typeof closeIssue>[0], issueId: string) =>
    withGuard(() =>
      closeIssue(client, f.db, {
        nonConformanceId: issueId,
        companyId: f.companyId,
        userId: USER
      })
    );

  async function writeOffs(issueId: string) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .select(["storageUnitId", "projectId", "quantity"])
      .where("documentType", "=", "Non-Conformance")
      .where("documentId", "=", issueId)
      .where("companyId", "=", f.companyId)
      .execute();
    return rows
      .map((row) => ({ ...row, quantity: Number(row.quantity) }))
      .sort((a, b) =>
        (a.storageUnitId ?? "").localeCompare(b.storageUnitId ?? "")
      );
  }

  postgrestTest(
    "writes the scrap off from the only bin that holds the item",
    async (client) => {
      const itemId = await itemWithStock("only-a", [
        { storageUnitId: binA, quantity: 10 }
      ]);
      const issueId = await issueWith("only-a", [
        { itemId, disposition: "Scrap", quantity: 3 }
      ]);
      expect((await close(client, issueId)).error).toBeNull();
      expect(await writeOffs(issueId)).toEqual([
        { storageUnitId: binA, projectId: null, quantity: -3 }
      ]);
    }
  );

  postgrestTest(
    "takes the quarantine stock first, then the fullest other bin",
    async (client) => {
      const itemId = await itemWithStock("held-first", [
        { storageUnitId: quarantine, quantity: 2 },
        { storageUnitId: binA, quantity: 10 },
        { storageUnitId: binB, quantity: 4 }
      ]);
      const issueId = await issueWith("held-first", [
        { itemId, disposition: "Scrap", quantity: 3 }
      ]);
      expect((await close(client, issueId)).error).toBeNull();
      expect(await writeOffs(issueId)).toEqual([
        { storageUnitId: binA, projectId: null, quantity: -1 },
        { storageUnitId: quarantine, projectId: null, quantity: -2 }
      ]);
    }
  );

  postgrestTest(
    "books the write-off at no storage unit when no bin holds the item",
    async (client) => {
      const itemId = await itemWithStock("none", []);
      const issueId = await issueWith("none", [
        { itemId, disposition: "Return to Supplier", quantity: 3 }
      ]);
      expect((await close(client, issueId)).error).toBeNull();
      expect(await writeOffs(issueId)).toEqual([
        { storageUnitId: null, projectId: null, quantity: -3 }
      ]);
    }
  );

  postgrestTest(
    "books a shortfall at the first bin drawn",
    async (client) => {
      const itemId = await itemWithStock("short", [
        { storageUnitId: quarantine, quantity: 2 }
      ]);
      const issueId = await issueWith("short", [
        { itemId, disposition: "Scrap", quantity: 5 }
      ]);
      expect((await close(client, issueId)).error).toBeNull();
      expect(await writeOffs(issueId)).toEqual([
        { storageUnitId: quarantine, projectId: null, quantity: -5 }
      ]);
    }
  );

  postgrestTest(
    "two rows of one item do not take the same stock twice",
    async (client) => {
      const itemId = await itemWithStock("two-rows", [
        { storageUnitId: quarantine, quantity: 2 },
        { storageUnitId: binA, quantity: 10 }
      ]);
      const issueId = await issueWith("two-rows", [
        { itemId, disposition: "Scrap", quantity: 2 },
        { itemId, disposition: "Return to Supplier", quantity: 2 }
      ]);
      expect((await close(client, issueId)).error).toBeNull();
      expect(await writeOffs(issueId)).toEqual([
        { storageUnitId: binA, projectId: null, quantity: -2 },
        { storageUnitId: quarantine, projectId: null, quantity: -2 }
      ]);
    }
  );

  postgrestTest(
    "leaves the stock an open inspection lot holds in its unit",
    async (client) => {
      const itemId = await itemWithStock("lot-held", [
        { storageUnitId: quarantine, quantity: 2 },
        { storageUnitId: binA, quantity: 10 }
      ]);
      await seed(f, (trx) =>
        trx
          .insertInto("inspection")
          .values({
            inspectionId: `${f.prefix}-INS-LOT-HELD`,
            itemId,
            lotSize: 2,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 2,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Receipt",
            sourceDocumentId: `${f.prefix}-receipt-lot-held`,
            sourceDocumentLineId: `${f.prefix}-line-lot-held`,
            storageUnitId: quarantine,
            status: "Pending",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      const issueId = await issueWith("lot-held", [
        { itemId, disposition: "Scrap", quantity: 3 }
      ]);
      expect((await close(client, issueId)).error).toBeNull();
      expect(await writeOffs(issueId)).toEqual([
        { storageUnitId: binA, projectId: null, quantity: -3 }
      ]);
    }
  );
});
