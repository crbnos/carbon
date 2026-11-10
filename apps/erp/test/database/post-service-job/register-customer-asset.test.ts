// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { expect } from "vitest";
import { registerCustomerAsset } from "../../../app/modules/service/service.server";
import { databaseTest } from "../fixtures/local-database";
import { localServiceRoleClient } from "../fixtures/local-supabase";
import { serviceJobFixture } from "../fixtures/service-job";

type Fixture = Awaited<ReturnType<typeof serviceJobFixture>>;

function callerService(f: Fixture) {
  const client = localServiceRoleClient();
  if (!client) throw new Error("This test needs the local stack");
  return createServiceContext({
    actor: { type: "system", onBehalfOf: "system" },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client as never,
    system: () => client as never,
    pg: () => f.db,
    kv: () => {
      throw new Error("The operation takes no kv");
    }
  });
}

databaseTest(
  "a customer of another company cannot own a registered asset",
  async () => {
    const f = await serviceJobFixture();
    const other = await serviceJobFixture();
    try {
      const { itemId } = await f.addStockedItem("pump", {
        quantity: 1,
        unitCost: 70
      });
      await f.db
        .updateTable("item")
        .set({ itemTrackingType: "Serial" })
        .where("id", "=", itemId)
        .execute();

      const result = await registerCustomerAsset(callerService(f), {
        itemId,
        serialNumber: "SN-1",
        customerId: other.customerId
      });

      expect(result.error?.category).toBe("notFound");
      const rows = await f.db
        .selectFrom("customerAsset")
        .select("id")
        .where("customerId", "=", other.customerId)
        .execute();
      expect(rows).toEqual([]);
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  }
);
