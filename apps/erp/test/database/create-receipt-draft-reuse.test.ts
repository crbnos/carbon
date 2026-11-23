// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. Receive on a purchase order must open the
// order's oldest Draft receipt, not start another one.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as inventory from "../../app/modules/inventory/inventory.server";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

let f: Fixture;
let ids: ReturnType<typeof idsOf>;

const idsOf = (prefix: string) => ({
  purchaseOrder: `${prefix}-po-draft-reuse`,
  otherPurchaseOrder: `${prefix}-po-other`,
  olderDraft: `${prefix}-receipt-older`,
  newerDraft: `${prefix}-receipt-newer`,
  otherOrderDraft: `${prefix}-receipt-other-order`
});

// The system, on behalf of the seeded system user: the permission gate passes.
const ctx = () =>
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

const draftReceipt = (
  id: string,
  receiptId: string,
  purchaseOrderId: string,
  createdAt: string
) => ({
  id,
  receiptId,
  status: "Draft" as const,
  sourceDocument: "Purchase Order" as const,
  sourceDocumentId: purchaseOrderId,
  locationId: f.locationId,
  companyId: f.companyId,
  createdBy: USER,
  createdAt
});

beforeAll(async () => {
  if (!client) return;
  f = await alwaysPostFixture();
  ids = idsOf(f.prefix);
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: ids.purchaseOrder,
        purchaseOrderId: `${f.prefix}-PO-REUSE`,
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("receipt")
      .values([
        // Another order's Draft is the oldest of all: it must not be reused.
        draftReceipt(
          ids.otherOrderDraft,
          `${f.prefix}-RE-OTHER`,
          ids.otherPurchaseOrder,
          "2026-01-01T00:00:00+00:00"
        ),
        draftReceipt(
          ids.olderDraft,
          `${f.prefix}-RE-OLDER`,
          ids.purchaseOrder,
          "2026-01-02T00:00:00+00:00"
        ),
        draftReceipt(
          ids.newerDraft,
          `${f.prefix}-RE-NEWER`,
          ids.purchaseOrder,
          "2026-01-03T00:00:00+00:00"
        )
      ])
      .execute();
  });
}, 60_000);

afterAll(async () => {
  if (!client) return;
  await f.cleanup();
}, 60_000);

const receiptCount = async () =>
  (
    await f.db
      .selectFrom("receipt")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute()
  ).length;

describeLocal("Receive on a purchase order", () => {
  it("opens the order's oldest Draft receipt and creates none", async () => {
    const before = await receiptCount();

    const result = await inventory.createReceipt(ctx(), {
      sourceDocument: "Purchase Order",
      sourceDocumentId: ids.purchaseOrder
    });

    expect(result.data).toEqual({ id: ids.olderDraft });
    expect(await receiptCount()).toBe(before);
  });
});
