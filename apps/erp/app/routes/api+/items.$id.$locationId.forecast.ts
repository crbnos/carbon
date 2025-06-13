import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { getItemDemand, getPeriods } from "~/modules/items/items.service";

const defaultResponse = {
  demand: [],
  periods: [],
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { id: itemId, locationId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!locationId) throw new Error("Could not find locationId");

  const startDate = startOfWeek(today(getLocalTimeZone()), "en-US");
  const endDate = startDate.add({ weeks: 18 * 4 });
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

  const [demand] = await Promise.all([
    getItemDemand(client, {
      itemId,
      locationId,
      periods: periods.data.map((p) => p.id ?? ""),
      companyId,
    }),
  ]);

  if (demand.error) {
    return json(
      defaultResponse,
      await flash(request, error(demand.error, "Failed to load demand"))
    );
  }

  return json({ demand: demand.data, periods: periods.data });
}
