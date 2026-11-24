// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { assignShipmentLineEntity } from "../../app/modules/inventory/inventory.server";
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
