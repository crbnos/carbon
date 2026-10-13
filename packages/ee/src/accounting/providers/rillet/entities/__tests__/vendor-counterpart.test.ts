// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import type { RilletVendorWrite } from "../../models";
import { RilletVendorSyncer } from "../vendor";

/**
 * The counterpart ladder, from the Rillet vendor syncer's side.
 *
 * `updateVendor` REWRITES the remote vendor's name, email and tax id. Two
 * suppliers for one legal entity share a tax id, so the ladder matches the
 * second supplier to the vendor the FIRST one already owns — and the mapping's
 * partial unique index, the only thing that knows this, used to be consulted
 * AFTER the update had already landed. Two guards, both tested here: the ladder
 * refuses a claimed record, and an adoption links before it mutates.
 */

/**
 * The mapping write runs inside `withTriggersDisabled`, a real Kysely transaction
 * that opens with a `SET LOCAL` statement. Stub it so the write is observable in
 * `writeOrder` — and so it can REFUSE, which is what the partial unique index
 * does when the remote vendor already belongs to another supplier.
 */
const { writeOrder, linkBehaviour } = vi.hoisted(() => ({
  writeOrder: [] as string[],
  linkBehaviour: { throws: false }
}));
vi.mock("../../../../core/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    cb: (tx: unknown) => Promise<unknown>
  ) => {
    const builder: Record<string, any> = {};
    builder.values = () => builder;
    builder.onConflict = () => builder;
    builder.execute = async () => {
      writeOrder.push("link");
      if (linkBehaviour.throws) {
        throw new Error(
          'duplicate key value violates unique constraint "externalIntegrationMapping_external_unique"'
        );
      }
      return [];
    };
    return cb({ insertInto: () => builder });
  }
}));

const COMPANY_ID = "company-1";

const payload = (
  overrides: Partial<RilletVendorWrite> = {}
): RilletVendorWrite =>
  ({
    name: "Acme Bolts West",
    email: "ap@acme.test",
    tax_id: "TX-9",
    external_references: [],
    ...overrides
  }) as RilletVendorWrite;

function setup(opts: {
  /** The Carbon supplier the matched remote vendor is already mapped to. */
  claimedBy?: string | null;
  /** Make the mapping write refuse, as the partial unique index would. */
  linkThrows?: boolean;
}) {
  const order = writeOrder;
  order.length = 0;
  linkBehaviour.throws = opts.linkThrows === true;

  const createVendor = vi.fn(async () => {
    order.push("createVendor");
    return { id: "V-NEW" };
  });
  const updateVendor = vi.fn(async () => {
    order.push("updateVendor");
    return { id: "V1" };
  });
  const findRemoteCandidates = vi.fn(async () => [
    { remoteId: "V1", name: "Acme Bolts East", taxId: "TX-9" }
  ]);

  const syncer = new RilletVendorSyncer({
    database: {} as never,
    companyId: COMPANY_ID,
    entityType: "vendor",
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    provider: {
      id: "rillet",
      capabilities: { searchableCounterparts: ["vendor", "customer"] },
      findRemoteCandidates,
      createVendor,
      updateVendor
    } as never
  });

  (syncer as any).mappingService = {
    // No mapping row for THIS supplier — the ladder is what resolves it.
    getExternalId: async () => null,
    // ...but the matched remote vendor may already belong to another one.
    getEntityId: async (_integration: string, remoteId: string) =>
      remoteId === "V1" ? (opts.claimedBy ?? null) : null
  };

  return {
    push: (localId = "sup_2") =>
      (syncer as any).upsertRemote(payload(), localId) as Promise<string>,
    createVendor,
    updateVendor,
    order
  };
}

describe("RilletVendorSyncer.upsertRemote — the counterpart ladder", () => {
  it("creates a new vendor rather than overwriting one another supplier owns", async () => {
    const test = setup({ claimedBy: "sup_1" });

    expect(await test.push("sup_2")).toBe("V-NEW");
    // The corruption this exists to stop: V1 is supplier sup_1's vendor, and
    // every one of its bills still points at it.
    expect(test.updateVendor).not.toHaveBeenCalled();
    expect(test.createVendor).toHaveBeenCalledTimes(1);
  });

  it("writes the mapping BEFORE it mutates an adopted vendor", async () => {
    const test = setup({ claimedBy: null });

    expect(await test.push("sup_2")).toBe("V1");
    // Order, not presence: the unique index is the only check that can catch a
    // mis-resolution, so it has to run while the remote record is intact.
    expect(test.order).toEqual(["link", "updateVendor"]);
  });

  it("leaves the remote vendor untouched when the mapping write refuses", async () => {
    const test = setup({ claimedBy: null, linkThrows: true });

    await expect(test.push("sup_2")).rejects.toThrow(/unique constraint/);
    expect(test.updateVendor).not.toHaveBeenCalled();
  });
});
