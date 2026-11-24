// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { assignShipmentLineEntity } from "../../app/modules/inventory/inventory.server";
import { getSerialNumbersForItem } from "../../app/modules/inventory/inventory.service";
import {
  findShipmentSerial,
  shipmentSerialLabels
} from "../../app/modules/inventory/inventory.utils";
import { alwaysPostFixture, USER } from "./fixtures/always-post";
import { operationContext, postgrestTest } from "./fixtures/local-supabase";
import { receiveProductionPair } from "./fixtures/packout-production";
import {
  createPackedShipment,
  postPackedShipment
} from "./fixtures/packout-shipment";

postgrestTest(
  "replacing a shipment pick preserves the exact serial through posting and refuses replay",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const plain = { id: production.first.id!, readableId: "SN-7" };
      const padded = { id: production.second.id!, readableId: " SN-7 " };
      for (const unit of [plain, padded]) {
        await f.db
          .updateTable("trackedEntity")
          .set({ readableId: unit.readableId })
          .where("companyId", "=", f.companyId)
          .where("id", "=", unit.id)
          .returning("id")
          .executeTakeFirstOrThrow();
      }
      const labels = shipmentSerialLabels([plain, padded]);
      expect(labels.get(plain.id)).toBe(`SN-7 · ${plain.id}`);
      expect(labels.get(padded.id)).toBe(`␠SN-7␠ · ${padded.id}`);
      const exact = findShipmentSerial(" SN-7 ", [plain, padded]);
      expect(exact).toEqual(padded);
      const draft = await createPackedShipment(
        f,
        production.productionItemId,
        "exact"
      );
      const ctx = operationContext(f, client, USER);
      const pick = (
        trackedEntityId: string,
        expectedTrackedEntityId?: string
      ) =>
        assignShipmentLineEntity(ctx, {
          trackingType: "serial",
          shipmentId: draft.shipmentId,
          shipmentLineId: draft.shipmentLineId,
          trackedEntityId,
          index: 0,
          expectedTrackedEntityId
        });
      expect((await pick(plain.id)).error).toBeNull();
      expect((await pick(exact!.id, plain.id)).error).toBeNull();
      expect((await pick(plain.id)).error?.message).toMatch(/selection|slot/i);
      expect((await pick(padded.id, plain.id)).error).toBeNull();
      const saved = await f.db
        .selectFrom("trackedEntity")
        .select(["id", "readableId"])
        .where("companyId", "=", f.companyId)
        .where(
          sql<boolean>`attributes->>'Shipment Line' = ${draft.shipmentLineId}`
        )
        .execute();
      expect(saved).toEqual([padded]);
      await postPackedShipment(
        f,
        draft,
        production.productionItemId,
        padded.id
      );
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "stock shipment scan and menu find a new receipt after 1,000 older consumed units",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await sql`
        INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "itemId", "readableId", quantity, status, "companyId", "createdBy")
        SELECT 'Item', ${f.assemblyId}, ${f.assemblyId}, 'OLD-' || n, 1, 'Consumed', ${f.companyId}, ${USER}
        FROM generate_series(1, 1000) n
      `.execute(f.db);
      // Make the available set span two pages as well.
      await sql`
        WITH available AS (
          INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "itemId", "readableId", quantity, status, "companyId", "createdBy")
          SELECT 'Item', ${f.assemblyId}, ${f.assemblyId}, 'STOCK-' || n, 1, 'Available', ${f.companyId}, ${USER}
          FROM generate_series(1, 1000) n
          RETURNING id
        )
        INSERT INTO "itemLedger" ("itemId", "trackedEntityId", "entryType", quantity, "locationId", "companyId", "createdBy")
        SELECT ${f.assemblyId}, id, 'Positive Adjmt.', 1, ${f.locationId}, ${f.companyId}, ${USER}
        FROM available
      `.execute(f.db);
      const production = await receiveProductionPair(f);
      await f.db
        .updateTable("trackedEntity")
        .set({ sourceDocument: "Job", sourceDocumentId: production.jobId })
        .where("companyId", "=", f.companyId)
        .where("id", "=", production.first.id!)
        .execute();
      const result = await getSerialNumbersForItem(client, {
        companyId: f.companyId,
        itemId: production.productionItemId,
        stockShipment: true
      });
      expect(result.error).toBeNull();
      const available = result.data ?? [];
      expect(available).toHaveLength(1002);
      expect(available.every((unit) => unit.status === "Available")).toBe(true);
      const selected = findShipmentSerial(production.first.serial, available);
      expect(selected?.id).toBe(production.first.id);
      expect(shipmentSerialLabels(available).get(production.first.id!)).toBe(
        production.first.serial
      );
      const draft = await createPackedShipment(
        f,
        production.productionItemId,
        "volume"
      );
      const assignment = await assignShipmentLineEntity(
        operationContext(f, client, USER),
        {
          trackingType: "serial",
          shipmentId: draft.shipmentId,
          shipmentLineId: draft.shipmentLineId,
          trackedEntityId: selected!.id,
          index: 0
        }
      );
      expect(assignment.error).toBeNull();
      await postPackedShipment(
        f,
        draft,
        production.productionItemId,
        production.first.id!
      );
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "batch tracking cannot replace a serial slot on a stock shipment",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const draft = await createPackedShipment(
        f,
        production.productionItemId,
        "mode"
      );
      const ctx = operationContext(f, client, USER);
      const line = {
        shipmentId: draft.shipmentId,
        shipmentLineId: draft.shipmentLineId
      };
      const pick = await assignShipmentLineEntity(ctx, {
        ...line,
        trackingType: "serial",
        trackedEntityId: production.first.id!,
        index: 0
      });
      expect(pick.error).toBeNull();
      const batch = await assignShipmentLineEntity(ctx, {
        ...line,
        trackingType: "batch",
        trackedEntityId: production.second.id!,
        quantity: 1
      });
      expect(batch.error?.message).toMatch(/tracking/i);
      await postPackedShipment(
        f,
        draft,
        production.productionItemId,
        production.first.id!
      );
    } finally {
      await f.cleanup();
    }
  }
);
