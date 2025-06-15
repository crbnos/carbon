import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import {
  getItemDemand,
  getItemQuantities,
  getItemSupply,
  getPeriods,
} from "~/modules/items/items.service";

const defaultResponse = {
  demand: [],
  supply: [],
  periods: [],
  quantityOnHand: 0,
};

const WEEKS_TO_FORECAST = 12 * 4;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { id: itemId, locationId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!locationId) throw new Error("Could not find locationId");

  const startDate = startOfWeek(today(getLocalTimeZone()), "en-US");
  const endDate = startDate.add({ weeks: WEEKS_TO_FORECAST });
  const periods = await getPeriods(client, {
    startDate: startDate.toString(),
    endDate: endDate.toString(),
  });

  if (periods.error) {
    return json(
      defaultResponse,
      await flash(request, error(periods.error, "Failed to load periods"))
    );
  }

  const [demand, supply, quantities] = await Promise.all([
    getItemDemand(client, {
      itemId,
      locationId,
      periods: periods.data.map((p) => p.id ?? ""),
      companyId,
    }),
    getItemSupply(client, {
      itemId,
      locationId,
      periods: periods.data.map((p) => p.id ?? ""),
      companyId,
    }),
    getItemQuantities(client, itemId, companyId, locationId),
  ]);

  if (demand.error) {
    return json(
      defaultResponse,
      await flash(request, error(demand.error, "Failed to load demand"))
    );
  }

  if (supply.error) {
    return json(
      defaultResponse,
      await flash(request, error(supply.error, "Failed to load supply"))
    );
  }

  return json({
    demand: demand.data,
    supply: supply.data,
    periods: periods.data,
    quantityOnHand: quantities.data?.quantityOnHand ?? 0,
  });
}
