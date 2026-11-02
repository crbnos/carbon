// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "../../../../core/fake-database-test-fixture";
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

const mapping = (entityId: string, externalId: string) => ({
  entityType: "vendor",
  entityId,
  integration: "rillet",
  externalId,
  companyId: COMPANY_ID
});

function setup(opts: {
  /** The Carbon supplier the matched remote vendor is already mapped to. */
  claimedBy?: string;
  /** Make the mapping write refuse, as the partial unique index would. */
  linkThrows?: boolean;
}) {
  // No mapping row for THIS supplier — the ladder is what resolves it.
  const db = fakeDatabase({
    externalIntegrationMapping: opts.claimedBy
      ? [mapping(opts.claimedBy, "V1")]
      : []
  });
  if (opts.linkThrows)
    db.failNextWrite(
      "externalIntegrationMapping",
      new Error(
        'duplicate key value violates unique constraint "externalIntegrationMapping_external_unique"'
      )
    );

  const createVendor = vi.fn(async () => ({ id: "V-NEW" }));
  /** The mapping rows as they stood when the remote vendor was rewritten. */
  let mappingsAtUpdate: unknown[] = [];
  const updateVendor = vi.fn(async () => {
    mappingsAtUpdate = db.rows("externalIntegrationMapping").map((row) => ({
      entityId: row.entityId,
      externalId: row.externalId
    }));
    return { id: "V1" };
  });
  const findRemoteCandidates = vi.fn(async () => [
    { remoteId: "V1", name: "Acme Bolts East", taxId: "TX-9" }
  ]);

  const syncer = new RilletVendorSyncer({
    database: db.database,
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

  return {
    push: (localId = "sup_2") =>
      (syncer as any).upsertRemote(payload(), localId) as Promise<string>,
    createVendor,
    updateVendor,
    mappingsAtUpdate: () => mappingsAtUpdate
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
    const test = setup({});

    expect(await test.push("sup_2")).toBe("V1");
    // Order, not presence: the unique index is the only check that can catch a
    // mis-resolution, so it has to run while the remote record is intact.
    expect(test.mappingsAtUpdate()).toEqual([
      { entityId: "sup_2", externalId: "V1" }
    ]);
  });

  it("leaves the remote vendor untouched when the mapping write refuses", async () => {
    const test = setup({ linkThrows: true });

    await expect(test.push("sup_2")).rejects.toThrow(/unique constraint/);
    expect(test.updateVendor).not.toHaveBeenCalled();
  });
});
