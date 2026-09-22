import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";

/**
 * Commercial (Business) demand-forecast AUTHORING — upserting and deleting a
 * company's `demandForecast` AND `demandProjection` rows, gated to the Business
 * plan via the `FORECAST` feature. The MRP consumer (`planning/mrp/mrp.ts`) that
 * READS forecasts is a separate concern and is not gated here.
 *
 * The entitlement LOCK lives INSIDE these commercial functions (see
 * `entitlements.server`) so it cannot be stripped from open-licensed app code.
 * Moving them out of the community `production.service.ts` also removes them as
 * ungated `production_upsert*` / `production_delete*` MCP tools — an ungated MCP
 * write path would otherwise route around the gate.
 *
 * The input shapes are declared inline (they carry no `~/` validator), so
 * `@carbon/ee` never imports app code.
 */

export async function upsertDemandForecasts(
  client: SupabaseClient<Database>,
  forecasts: Array<{
    itemId: string;
    locationId: string;
    periodId: string;
    forecastQuantity: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }>
) {
  // Source companyId from the payload so the entitlement check (the lock) can
  // run before any write. An empty batch writes nothing and needs no gate.
  const companyId = forecasts[0]?.companyId;
  if (companyId) {
    await requireEntitlement(client, companyId, "FORECAST");
  }

  // Delete existing forecasts with 0 quantity, upsert others
  const toDelete = forecasts.filter((f) => f.forecastQuantity === 0);
  const toUpsert = forecasts.filter((f) => f.forecastQuantity > 0);

  const promises = [];

  if (toDelete.length > 0) {
    for (const forecast of toDelete) {
      promises.push(
        client
          .from("demandForecast")
          .delete()
          .eq("itemId", forecast.itemId)
          .eq("locationId", forecast.locationId)
          .eq("periodId", forecast.periodId)
          .eq("companyId", forecast.companyId)
      );
    }
  }

  if (toUpsert.length > 0) {
    promises.push(
      client.from("demandForecast").upsert(
        toUpsert.map((f) => ({
          ...f,
          updatedBy: f.updatedBy ?? f.createdBy ?? "system",
          updatedAt: new Date().toISOString()
        })),
        {
          onConflict: "itemId,locationId,periodId,companyId"
        }
      )
    );
  }

  const results = await Promise.all(promises);
  const hasError = results.some((r) => r.error);

  return {
    data: hasError ? null : toUpsert,
    error: hasError ? results.find((r) => r.error)?.error : null
  };
}

export async function deleteDemandForecasts(
  client: SupabaseClient<Database>,
  params: {
    itemId: string;
    locationId: string;
    companyId: string;
    futurePeriodIds: string[];
  }
) {
  const { itemId, locationId, companyId, futurePeriodIds } = params;

  await requireEntitlement(client, companyId, "FORECAST");

  const result = await client
    .from("demandForecast")
    .delete()
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .in("periodId", futurePeriodIds);

  return {
    data: result.data,
    error: result.error
  };
}

export async function upsertDemandProjections(
  client: SupabaseClient<Database>,
  forecasts: Array<{
    itemId: string;
    locationId: string;
    periodId: string;
    forecastQuantity: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }>
) {
  // Source companyId from the payload so the entitlement check (the lock) can
  // run before any write. An empty batch writes nothing and needs no gate.
  const companyId = forecasts[0]?.companyId;
  if (companyId) {
    await requireEntitlement(client, companyId, "FORECAST");
  }

  // Delete existing forecasts with 0 quantity, upsert others
  const toDelete = forecasts.filter((f) => f.forecastQuantity === 0);
  const toUpsert = forecasts.filter((f) => f.forecastQuantity > 0);

  const promises = [];

  if (toDelete.length > 0) {
    for (const forecast of toDelete) {
      promises.push(
        client
          .from("demandProjection")
          .delete()
          .eq("itemId", forecast.itemId)
          .eq("locationId", forecast.locationId)
          .eq("periodId", forecast.periodId)
          .eq("companyId", forecast.companyId)
      );
    }
  }

  if (toUpsert.length > 0) {
    promises.push(
      client.from("demandProjection").upsert(
        toUpsert.map((f) => ({
          ...f,
          updatedBy: f.updatedBy ?? f.createdBy ?? "system",
          updatedAt: new Date().toISOString()
        })),
        {
          onConflict: "itemId,locationId,periodId,companyId"
        }
      )
    );
  }

  const results = await Promise.all(promises);
  const hasError = results.some((r) => r.error);

  return {
    data: hasError ? null : toUpsert,
    error: hasError ? results.find((r) => r.error)?.error : null
  };
}

export async function deleteDemandProjections(
  client: SupabaseClient<Database>,
  params: {
    itemId: string;
    locationId: string;
    companyId: string;
    futurePeriodIds: string[];
  }
) {
  const { itemId, locationId, companyId, futurePeriodIds } = params;

  await requireEntitlement(client, companyId, "FORECAST");

  const result = await client
    .from("demandProjection")
    .delete()
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .in("periodId", futurePeriodIds);

  return {
    data: result.data,
    error: result.error
  };
}
