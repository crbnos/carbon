// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What `post-asset-transfer` `capitalize` would book for a serialized unit,
// without booking it: the same `calculateCOGS` relief, in a transaction that
// always rolls back. The capitalize form shows this instead of the item's unit
// cost, which differs from the posted amount whenever the unit's own cost
// layer (or the average, or a layer at net book value) is not that cost.

import { round } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import { calculateCOGS } from "../lib/calculate-cogs";

export const previewAssetCapitalizationInput = z.object({
  trackedEntityId: z.string().min(1)
});

export type CapitalizationPreview = { cost: number };

/** Thrown at the end of the preview transaction so it never commits. */
class RollbackPreview extends Error {
  constructor(readonly preview: CapitalizationPreview) {
    super("preview rollback");
  }
}

const previewAssetCapitalization = defineServerFn({
  name: "preview-asset-capitalization",
  input: previewAssetCapitalizationInput,
  permissions: { view: "accounting" },
  async run({ db, companyId }, { trackedEntityId }) {
    const entity = await db
      .selectFrom("trackedEntity")
      .select("itemId")
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!entity?.itemId) throw new NotFoundError("Tracked entity not found");
    const itemId = entity.itemId;

    try {
      await db.transaction().execute(async (trx) => {
        const cogs = await calculateCOGS(trx, {
          itemId,
          quantity: 1,
          companyId,
          trackedEntityIds: [trackedEntityId]
        });
        throw new RollbackPreview({ cost: round(cogs.totalCost) });
      });
    } catch (error) {
      if (error instanceof RollbackPreview) return error.preview;
      throw error;
    }
    throw new Error("Capitalization preview did not roll back");
  }
});

export default previewAssetCapitalization;
