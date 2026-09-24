import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { consumableInWholeAssemblies } from "@carbon/database/supersession-pick";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { mergeDemandProjections } from "~/modules/items/demand-projection";
import {
  getDemandForecastSources,
  getItemDemand,
  getItemQuantities,
  getItemSupply,
  getOpenJobMaterials,
  getOpenProductionOrders,
  getOpenPurchaseOrderLines,
  getOpenSalesOrderLines
} from "~/modules/items/items.service";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";

const defaultResponse = {
  demand: [],
  demandForecast: [],
  demandForecastSources: [],
  supply: [],
  periods: [],
  quantityOnHand: 0,
  openSalesOrderLines: [],
  openJobMaterials: [],
  openProductionOrders: [],
  openPurchaseOrderLines: []
};

const WEEKS_TO_FORECAST = 12 * 4;

type OpenJobMaterialLine = NonNullable<
  Awaited<ReturnType<typeof getOpenJobMaterials>>["data"]
>[number] & { redirectedFromReadableId?: string | null };

function redirectJobMaterialLines(
  lines: OpenJobMaterialLine[],
  mode: string,
  onHand: number
): { kept: OpenJobMaterialLine[]; moved: OpenJobMaterialLine[] } {
  const kept: OpenJobMaterialLine[] = [];
  const moved: OpenJobMaterialLine[] = [];
  let remaining = mode === "Consume First" ? Math.max(0, onHand) : 0;
  const sorted = [...lines].sort((a, b) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
  );
  for (const line of sorted) {
    const quantity = Number(line.quantity ?? 0);
    const covered = Math.min(
      quantity,
      consumableInWholeAssemblies(
        remaining,
        Number(line.quantityPerParent ?? 0)
      )
    );
    remaining -= covered;
    if (covered > 0) kept.push({ ...line, quantity: covered });
    if (quantity - covered > 0) {
      moved.push({ ...line, quantity: quantity - covered });
    }
  }
  return { kept, moved };
}

const REDIRECTING_MODES = new Set([
  "Consume First",
  "Prefer New",
  "Stock Only"
]);

async function getRedirectedOpenJobMaterials(
  client: Parameters<typeof getOpenJobMaterials>[0],
  args: {
    itemId: string;
    locationId: string;
    companyId: string;
    today: string;
    onHand: number;
    lines: OpenJobMaterialLine[];
  }
): Promise<OpenJobMaterialLine[]> {
  const { itemId, locationId, companyId, today, onHand } = args;
  const effective = (rule: {
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    successorItemId: string | null;
    successorEffectivityDate: string | null;
  }) =>
    REDIRECTING_MODES.has(rule.supersessionMode) &&
    !!rule.successorItemId &&
    (!rule.successorEffectivityDate || rule.successorEffectivityDate <= today);

  const [own, incoming] = await Promise.all([
    client
      .from("itemSupersession")
      .select("supersessionMode, successorItemId, successorEffectivityDate")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("itemSupersession")
      .select(
        "itemId, supersessionMode, successorItemId, successorEffectivityDate, conversionFactor, predecessor:item!itemSupersession_itemId_fkey(readableIdWithRevision)"
      )
      .eq("successorItemId", itemId)
      .eq("companyId", companyId)
  ]);

  if (own.error) throw new Error(own.error.message);
  if (incoming.error) throw new Error(incoming.error.message);

  let lines = args.lines;
  if (own.data && effective(own.data)) {
    lines = redirectJobMaterialLines(
      lines,
      own.data.supersessionMode,
      onHand
    ).kept;
  }

  for (const rule of incoming.data ?? []) {
    if (!effective(rule)) continue;
    const [predecessorLines, quantities] = await Promise.all([
      getOpenJobMaterials(client, {
        itemId: rule.itemId,
        companyId,
        locationId
      }),
      getItemQuantities(client, rule.itemId, companyId, locationId)
    ]);
    if (predecessorLines.error) {
      throw new Error(predecessorLines.error.message);
    }
    if (quantities.error) throw new Error(quantities.error.message);
    const factor = Number(rule.conversionFactor ?? 1) || 1;
    const { moved } = redirectJobMaterialLines(
      predecessorLines.data ?? [],
      rule.supersessionMode,
      Number(quantities.data?.quantityOnHand ?? 0)
    );
    for (const line of moved) {
      lines.push({
        ...line,
        quantity: Number(line.quantity ?? 0) * factor,
        redirectedFromReadableId:
          rule.predecessor?.readableIdWithRevision ?? rule.itemId
      });
    }
  }
  return lines;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { id: itemId, locationId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!locationId) throw new Error("Could not find locationId");

  const today = datetime.today(
    await getLocationTimeZone(client, locationId, companyId)
  );
  const periods = await getOrCreatePeriods(today, WEEKS_TO_FORECAST);

  const [
    demand,
    supply,
    quantities,
    openSalesOrderLines,
    openJobMaterials,
    openProductionOrders,
    openPurchaseOrderLines,
    demandForecastSources
  ] = await Promise.all([
    getItemDemand(client, {
      itemId,
      locationId,
      periods: periods.map((p) => p.id ?? ""),
      companyId
    }),
    getItemSupply(client, {
      itemId,
      locationId,
      periods: periods.map((p) => p.id ?? ""),
      companyId
    }),
    getItemQuantities(client, itemId, companyId, locationId),
    getOpenSalesOrderLines(client, { itemId, companyId, locationId }),
    getOpenJobMaterials(client, { itemId, companyId, locationId }),
    getOpenProductionOrders(client, { itemId, companyId, locationId }),
    getOpenPurchaseOrderLines(client, { itemId, companyId, locationId }),
    getDemandForecastSources(client, {
      itemId,
      locationId,
      periods: periods.map((p) => p.id ?? ""),
      companyId
    })
  ]);

  // Reconcile the chart with the planning grid: the planning RPCs count
  // planner projections as demand, so the chart must too. See
  // `mergeDemandProjections` for the per-period rule.
  const demandForecast = mergeDemandProjections(
    demand.forecasts,
    demand.projections
  );

  if (demand.actuals.length === 0 && demandForecast.length === 0) {
    return data(
      defaultResponse,
      await flash(request, error(null, "Failed to load demand"))
    );
  }

  const redirectedOpenJobMaterials = await getRedirectedOpenJobMaterials(
    client,
    {
      itemId,
      locationId,
      companyId,
      today: today.toString(),
      onHand: Number(quantities.data?.quantityOnHand ?? 0),
      lines: openJobMaterials.data ?? []
    }
  );

  return {
    demand: demand.actuals,
    demandForecast,
    demandForecastSources: demandForecastSources.data ?? [],
    supply: [
      ...supply.actuals,
      ...supply.forecasts.map((f) => ({
        ...f,
        actualQuantity: f.forecastQuantity
      }))
    ],
    periods,
    quantityOnHand: quantities.data?.quantityOnHand ?? 0,
    openSalesOrderLines: openSalesOrderLines.data ?? [],
    openJobMaterials: redirectedOpenJobMaterials,
    openProductionOrders: openProductionOrders.data ?? [],
    openPurchaseOrderLines: openPurchaseOrderLines.data ?? []
  };
}
