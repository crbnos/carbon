import { requirePermissions } from "@carbon/auth/auth.server";
import type { Json } from "@carbon/database";
import {
  ITEM_METHOD_TYPES,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_TRACKING_TYPES,
  PUSH_DEFAULT_SETTING_NAMES
} from "@carbon/ee";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import { sql } from "kysely";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getDatabaseClient } from "~/services/database.server";

export const config = {
  runtime: "nodejs"
};

/**
 * The company's push defaults, saved from the panel's Settings page.
 *
 * These used to live only on the integration's settings form in Carbon, which
 * meant someone working inside Onshape had to leave the CAD document, find
 * Settings → Integrations, change a default and come back. They are read on
 * every plan (`parsePushDefaults`), so the panel is where they are decided.
 *
 * Permissive like the settings form was: a blank unit is "decide from the
 * company's list", and `parsePushDefaults` remains the single place a stored
 * value is validated, so a save can never write a shape a plan cannot read.
 */
const payloadSchema = z.object({
  defaultUnitOfMeasureCode: z.string().trim().max(50),
  defaultReplenishmentSystem: z.enum(ITEM_REPLENISHMENT_SYSTEMS),
  defaultMethodTypeForMake: z.enum(ITEM_METHOD_TYPES),
  defaultMethodTypeForBuy: z.enum(ITEM_METHOD_TYPES),
  defaultItemTrackingType: z.enum(ITEM_TRACKING_TYPES)
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push defaults" }, { status: 400 });
  }
  const defaults = parsed.data;

  // A unit must be one of the company's own, or blank. The panel offers only
  // those, so this is the guard for a hand-made payload.
  if (defaults.defaultUnitOfMeasureCode !== "") {
    const unit = await client
      .from("unitOfMeasure")
      .select("code")
      .eq("companyId", companyId)
      .eq("code", defaults.defaultUnitOfMeasureCode)
      .maybeSingle();
    if (unit.error) {
      return data(
        { error: "Failed to read units of measure" },
        { status: 500 }
      );
    }
    if (!unit.data) {
      return data(
        {
          error: `${defaults.defaultUnitOfMeasureCode} is not one of your units`
        },
        { status: 422 }
      );
    }
  }

  /*
   * Only these keys are written, and the merge happens in the database. The
   * metadata column also carries `credentials`, `propertyMap`, `baseUrl` and
   * `onshapeCompanyId`, and other writers — the token refresh inside
   * `getOnshapeClient`, the Fields save — are read-modify-writers of the whole
   * column. A read-spread-write here would be reverted by whichever of those
   * lands in between. `||` is a shallow merge, so every sibling key survives
   * exactly as the row holds it. The column is `json`, hence the casts.
   */
  const patch = Object.fromEntries(
    PUSH_DEFAULT_SETTING_NAMES.map((name) => [name, defaults[name]])
  );

  const db = getDatabaseClient();
  const updated = await db
    .updateTable("companyIntegration")
    .set({
      metadata: sql<Json>`(coalesce(metadata::jsonb, '{}'::jsonb) || ${JSON.stringify(
        patch
      )}::jsonb)::json`
    })
    .where("id", "=", ONSHAPE_V2_INTEGRATION_ID)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  // No row means the integration is not installed for this company, which the
  // panel cannot reach — it needs a token minted against an installed one.
  if (!updated.numUpdatedRows) {
    return data(
      { error: "Onshape is not connected for this company" },
      {
        status: 422
      }
    );
  }

  return data({ defaults }, { headers: { "Cache-Control": "no-store" } });
}
