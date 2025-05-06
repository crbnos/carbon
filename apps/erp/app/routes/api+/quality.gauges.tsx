import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getGaugesList, getGaugeTypesList } from "~/modules/quality";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const [gauges, gaugeTypes] = await Promise.all([
    getGaugesList(client, companyId),
    getGaugeTypesList(client, companyId),
  ]);

  return json({ gauges: gauges.data ?? [], gaugeTypes: gaugeTypes.data ?? [] });
}
