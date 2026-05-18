import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getGaugesList, getGaugeTypesList } from "~/modules/quality";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality"
  });

  const [gauges, gaugeTypes] = await Promise.all([
    getGaugesList(),
    getGaugeTypesList()
  ]);

  return { gauges: gauges.data ?? [], gaugeTypes: gaugeTypes.data ?? [] };
}
