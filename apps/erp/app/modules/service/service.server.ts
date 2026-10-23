// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The operations of the service module: customer assets. The building blocks
// they run are in `service.service.ts`.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import type { Json } from "@carbon/database";
import { z } from "zod";
import {
  customerAssetUpdateValidator,
  customerAssetValidator
} from "./service.models";
import * as service from "./service.service";

// --- Customer assets -------------------------------------------------------------

/**
 * Register a customer asset for a unit sold before Carbon.
 *
 * @remarks
 * A Consumed `trackedEntity` for the typed serial and the customer asset
 * (source Manual), in one transaction. A serial Carbon already tracks for the
 * item, or an item that is not serialized, is a `rule` error.
 */
export const registerCustomerAsset = defineServiceFn({
  input: customerAssetValidator,
  permission: { create: "service" },

  async run(ctx, input) {
    try {
      return await service.registerCustomerAsset(ctx.asSystem.pg, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return err instanceof service.CustomerAssetError
        ? ctx.error("rule", err.message, err)
        : ctx.error("internal", "Failed to register the customer asset", err);
    }
  }
});

/**
 * Save the fields a service manager edits on a customer asset.
 *
 * @remarks
 * The site, the two warranty end dates and the notes.
 */
export const updateCustomerAsset = defineServiceFn({
  input: customerAssetUpdateValidator,
  permission: { update: "service" },

  async run(ctx, input) {
    const update = await service.upsertCustomerAsset(ctx.asCaller.supabase, {
      ...input,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update the asset", update.error);
    }
    return { id: input.id };
  }
});

/** Save a customer asset's notes. */
export const updateCustomerAssetNotes = defineServiceFn({
  input: z.object({ id: z.string(), notes: z.custom<Json>() }),
  permission: { update: "service" },

  async run(ctx, { id, notes }) {
    const update = await service.updateCustomerAssetNotes(
      ctx.asCaller.supabase,
      { id, notes, companyId: ctx.company.id, updatedBy: ctx.auditUserId }
    );
    if (update.error) return ctx.error("rule", update.error.message);
    return { id };
  }
});
