import { requirePermissions } from "@carbon/auth/auth.server";
import {
  now,
  parseAbsolute,
  parseDateTime,
  toCalendarDateTime,
} from "@internationalized/date";
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

  console.log({ start, end });

  const startDate = toCalendarDateTime(parseDateTime(start));
  const endDate = toCalendarDateTime(parseDateTime(end));
  const currentDate = toCalendarDateTime(now("UTC"));

  const daysBetween = endDate.compare(startDate);

  console.log({
    startDate: startDate.toString(),
    endDate: endDate.toString(),
    currentDate: currentDate.toString(),
    daysBetween,
  });

  // Calculate previous period dates
  const previousEndDate = startDate;
  const previousStartDate = startDate.add({ days: -daysBetween });

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
              const startTime = parseAbsolute(event.startTime, "UTC");
              const endTime = event.endTime
                ? parseAbsolute(event.endTime, "UTC")
                : currentDate;
              return total + endTime.compare(startTime);
            }, 0);

            return {
              key: workCenter.name,
              value: totalDuration,
            };
          }) ?? []
        ).sort((a, b) => b.value - a.value);
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
