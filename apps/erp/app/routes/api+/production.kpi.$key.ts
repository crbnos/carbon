import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { KPIs } from "~/modules/production/production.models";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
  });
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const start = String(searchParams.get("start"));
  const end = String(searchParams.get("end"));

  const startDate = new Date(start);
  const endDate = new Date(end);
  const currentDate = new Date();

  const daysBetween = Math.floor(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Calculate previous period dates
  const previousEndDate = startDate;
  const previousStartDate = new Date(
    startDate.getTime() - daysBetween * 24 * 60 * 60 * 1000
  );

  const interval = searchParams.get("interval");

  const { key } = params;

  if (
    !key ||
    !start ||
    !end ||
    !interval ||
    daysBetween < 1 ||
    daysBetween > 500
  )
    return json({
      data: [],
      previousPeriodData: [],
    });

  const kpi = KPIs.find((k) => k.key === key);
  if (!kpi)
    return json({
      data: [],
      previousPeriodData: [],
    });

  switch (kpi.key) {
    case "utilization": {
      const [workCenters, productionEvents, previousProductionEvents] =
        await Promise.all([
          client
            .from("workCenter")
            .select("id, name")
            .eq("companyId", companyId)
            .eq("active", true),
          client
            .from("productionEvent")
            .select("startTime, endTime, workCenterId")
            .eq("companyId", companyId)
            .gt("startTime", start)
            .or(`endTime.lte.${end},endTime.is.null`)
            .order("startTime", { ascending: false }),
          client
            .from("productionEvent")
            .select("startTime, endTime, workCenterId")
            .eq("companyId", companyId)
            .gt("startTime", previousStartDate.toString())
            .or(`endTime.lte.${previousEndDate.toString()},endTime.is.null`)
            .order("startTime", { ascending: false }),
        ]);

      const [data, previousPeriodData] = [
        productionEvents.data ?? [],
        previousProductionEvents.data ?? [],
      ].map((events) => {
        return (
          workCenters.data?.map((workCenter) => {
            const workCenterEvents = events.filter(
              (event) => event.workCenterId === workCenter.id
            );

            const totalDuration = workCenterEvents.reduce((total, event) => {
              const startTime = new Date(event.startTime);
              const endTime = event.endTime
                ? new Date(event.endTime)
                : currentDate;
              return total + (endTime.getTime() - startTime.getTime());
            }, 0);

            return {
              key: workCenter.name,
              value: totalDuration,
            };
          }) ?? []
        );
      });

      return json({
        data,
        previousPeriodData,
      });
    }

    default:
      throw new Error(`Invalid KPI key: ${key}`);
  }
}
