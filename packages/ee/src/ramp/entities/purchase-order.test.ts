import { describe, expect, it } from "vitest";
import type { EntityConfig, SyncContext } from "../../accounting/core/types";
import { buildRampIdempotencyKey, RampApiError } from "../lib/client";
import type { RampPurchaseOrderBatch } from "../lib/spend";
import {
  RAMP_PURCHASE_ORDER_NUMBER_SUFFIX,
  type RampPurchaseOrderRemote,
  RampPurchaseOrderSyncer,
  toRampPurchaseOrderNumber
} from "./purchase-order";

/**
 * Ramp's `purchase_order_number` handling, mapped live against the sandbox on
 * 2026-09-26 and documented nowhere:
 *
 * | sent          | stored          |
 * |---------------|-----------------|
 * | `PO000002`    | `2`             |
 * | `PO999999`    | `999999`        |
 * | `PO000123`    | `123`           |
 * | `PO-000004`   | rejected (→ `4`)|
 * | `PO000004-1`  | `PO000004-1`    |
 * | `PO000004-A`  | `PO000004-A-1`  |
 *
 * Uniqueness is enforced on the REDUCED value, which is why an unsuffixed Carbon
 * readable id collides with whatever the customer's Ramp account already holds.
 */
describe("toRampPurchaseOrderNumber", () => {
  it("keeps the Carbon readable id recognisable", () => {
    expect(toRampPurchaseOrderNumber("PO000004")).toBe("PO000004-1");
    expect(toRampPurchaseOrderNumber("PO123456")).toBe("PO123456-1");
  });

  it("appends a NUMERIC suffix", () => {
    // A non-numeric tail does not survive: Ramp stored `PO000004-A` as
    // `PO000004-A-1`, appending its own. Only a numeric suffix round-trips, so
    // what Carbon sends is what a human sees.
    expect(RAMP_PURCHASE_ORDER_NUMBER_SUFFIX).toMatch(/^-\d+$/);
  });

  it("leaves Carbon's readable-id format in a form Ramp stores verbatim", () => {
    // VERIFIED, not derived. Ramp's transform could not be reduced to a rule by
    // probing — `PO-2026-003` came back `2026-3` (leading `PO-` dropped, trailing
    // zeros dropped) while `PO000004-1` came back untouched, and the two are not
    // reconcilable into one predicate. So this pins the case that was actually
    // exercised: Carbon's own `PO` + six digits, which is what the sequence emits
    // by default, suffixed.
    expect(toRampPurchaseOrderNumber("PO000004")).toBe("PO000004-1");
    // `PO000004-1` was accepted and stored verbatim against a Ramp business where
    // the number `4` was already taken — twice, including after the first was
    // archived.
  });

  it("is deterministic, so a re-push addresses the same Ramp document", () => {
    // `upsertRemote` finds an existing purchase order by `external_id`, not by
    // number — but a number that changed between pushes would still rename the
    // customer's document under them on every sync.
    expect(toRampPurchaseOrderNumber("PO000004")).toBe(
      toRampPurchaseOrderNumber("PO000004")
    );
  });
});

const COMPANY_ID = "company-1";

type FakeRamp = {
  createdKeys: string[];
  patched: string[];
  patchPurchaseOrder(id: string, body: unknown): Promise<unknown>;
  createPurchaseOrder(body: unknown, idempotencyKey?: string): Promise<unknown>;
  findPurchaseOrderByExternalId(
    externalId: string
  ): Promise<{ id: string } | null>;
  archivePurchaseOrder(id: string): Promise<unknown>;
};

function makeRamp(args: { patchStatus?: number } = {}): FakeRamp {
  const ramp: FakeRamp = {
    createdKeys: [],
    patched: [],
    async patchPurchaseOrder(id) {
      ramp.patched.push(id);
      if (args.patchStatus) {
        throw new RampApiError(
          args.patchStatus,
          args.patchStatus === 404 ? "DEVELOPER_7002" : "DEVELOPER_7001",
          "not found"
        );
      }
      return {};
    },
    async createPurchaseOrder(_body, idempotencyKey) {
      ramp.createdKeys.push(idempotencyKey ?? "");
      return { id: `po_${ramp.createdKeys.length}` };
    },
    async findPurchaseOrderByExternalId() {
      return null;
    },
    async archivePurchaseOrder() {
      return {};
    }
  };
  return ramp;
}

/**
 * `upsertRemote` only reaches the mapping service when `this.batch` has no entry
 * for the id, so seeding the batch keeps the database out of these tests
 * entirely — exactly the prefetch the real batch path performs.
 */
function makeSyncer(args: {
  ramp: FakeRamp;
  mappedRemoteId?: string;
}): RampPurchaseOrderSyncer {
  // Only reached by the unmapped case (`getRemoteId`), and only to answer
  // "no mapping row".
  const emptyMappingRead = {
    selectFrom: () => {
      const query = {
        select: () => query,
        where: () => query,
        executeTakeFirst: async () => undefined
      };
      return query;
    }
  };

  const context: SyncContext = {
    database: emptyMappingRead as never,
    companyId: COMPANY_ID,
    provider: { id: "ramp", client: args.ramp } as never,
    entityType: "purchaseOrder",
    config: {
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    } as EntityConfig
  };

  const syncer = new RampPurchaseOrderSyncer(context);
  const batch: Pick<RampPurchaseOrderBatch, "purchaseOrderIds"> = {
    purchaseOrderIds: new Map(
      args.mappedRemoteId ? [["po-local-1", args.mappedRemoteId]] : []
    )
  };
  (syncer as unknown as { batch: unknown }).batch = batch;
  return syncer;
}

function payload(): RampPurchaseOrderRemote {
  return {
    archive: false,
    purchase_order_number: "PO000018-1",
    external_id: "po-local-1",
    three_way_match_enabled: false,
    currency: "USD",
    entity_id: "ent_1",
    line_items: []
  };
}

async function push(
  syncer: RampPurchaseOrderSyncer,
  data: RampPurchaseOrderRemote
): Promise<string> {
  return (
    syncer as unknown as {
      upsertRemote(
        data: RampPurchaseOrderRemote,
        localId: string
      ): Promise<string>;
    }
  ).upsertRemote(data, "po-local-1");
}

/**
 * The bug this pins: `buildRampIdempotencyKey` is deterministic, so the
 * 404-recreate path reused the key the ORIGINAL create used. An idempotency key
 * Ramp still retains makes it replay the original response, so the "new"
 * purchase order is the archived one the PATCH just 404'd on — the mapping is
 * rewritten to the same dead id and the document never recovers; if Ramp instead
 * refuses the reuse (`DEVELOPER_7005`) the push just fails. Ramp documents no
 * replay window at all, so neither can be ruled out by the age of the original.
 */
describe("RampPurchaseOrderSyncer recreate idempotency", () => {
  it("uses the plain entity-scoped key for a first create", async () => {
    const ramp = makeRamp();
    const syncer = makeSyncer({ ramp });

    await push(syncer, payload());

    expect(ramp.patched).toEqual([]);
    expect(ramp.createdKeys).toEqual([
      buildRampIdempotencyKey({
        companyId: COMPANY_ID,
        operation: "createPurchaseOrder",
        scope: "po-local-1"
      })
    ]);
  });

  it("uses a DIFFERENT key when recreating after a 404 PATCH", async () => {
    const ramp = makeRamp({ patchStatus: 404 });
    const syncer = makeSyncer({ ramp, mappedRemoteId: "po_archived" });

    const remoteId = await push(syncer, payload());

    expect(ramp.patched).toEqual(["po_archived"]);
    expect(remoteId).toBe("po_1");

    const firstCreateKey = buildRampIdempotencyKey({
      companyId: COMPANY_ID,
      operation: "createPurchaseOrder",
      scope: "po-local-1"
    });
    expect(ramp.createdKeys).not.toContain(firstCreateKey);
    // Discriminated by the stale remote id, so it stays DETERMINISTIC: a
    // transient retry of the same recreate reuses this key and still cannot
    // double-create.
    expect(ramp.createdKeys).toEqual([
      buildRampIdempotencyKey({
        companyId: COMPANY_ID,
        operation: "createPurchaseOrder",
        scope: "po-local-1:recreate:po_archived"
      })
    ]);
  });

  it("gives each stale remote id its own recreate key", async () => {
    const first = makeRamp({ patchStatus: 404 });
    const second = makeRamp({ patchStatus: 404 });

    await push(
      makeSyncer({ ramp: first, mappedRemoteId: "po_old_a" }),
      payload()
    );
    await push(
      makeSyncer({ ramp: second, mappedRemoteId: "po_old_b" }),
      payload()
    );

    expect(first.createdKeys[0]).not.toBe(second.createdKeys[0]);
  });

  it("rethrows a non-404 PATCH failure instead of recreating", async () => {
    const ramp = makeRamp({ patchStatus: 422 });
    const syncer = makeSyncer({ ramp, mappedRemoteId: "po_live" });

    await expect(push(syncer, payload())).rejects.toBeInstanceOf(RampApiError);
    expect(ramp.createdKeys).toEqual([]);
  });
});
