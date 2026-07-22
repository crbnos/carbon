import { requirePermissions } from "@carbon/auth/auth.server";
import { type HealthCheckItem, LiveView } from "@carbon/onboarding/ui";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { path } from "~/utils/path";

// Live on Carbon — the scoreboard reads from the hub store; this loader adds
// the daily five-minute health check (each line links to the screen that
// fixes it). Cheap head-count queries, computed fresh per visit.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const today = new Date().toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();

  const [idleJobs, lateOrders, latePos] = await Promise.all([
    client
      .from("job")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .in("status", ["In Progress", "Paused"])
      .lt("updatedAt", twoDaysAgo),
    client
      .from("salesOrderLine")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .lt("promisedDate", today)
      .is("sentDate", null),
    client
      .from("purchaseOrderLine")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .lt("promisedDate", today)
      .is("receivedDate", null)
  ]);

  return {
    idleJobs: idleJobs.count ?? 0,
    lateOrders: lateOrders.count ?? 0,
    latePos: latePos.count ?? 0
  };
}

export default function GetStartedLiveRoute() {
  const { t } = useLingui();
  const { idleJobs, lateOrders, latePos } = useLoaderData<typeof loader>();

  const healthChecks: HealthCheckItem[] = [
    {
      key: "idle-jobs",
      label: t`Jobs started but idle two or more days`,
      count: idleJobs,
      url: path.to.jobs
    },
    {
      key: "late-orders",
      label: t`Order lines past their promise date, not shipped`,
      count: lateOrders,
      url: path.to.salesOrders
    },
    {
      key: "late-pos",
      label: t`Purchase order lines past due, not received`,
      count: latePos,
      url: path.to.purchaseOrders
    }
  ];

  return <LiveView healthChecks={healthChecks} />;
}
