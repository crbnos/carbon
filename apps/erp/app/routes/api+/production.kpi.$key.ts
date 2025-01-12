import { requirePermissions } from "@carbon/auth/auth.server";
import {
  now,
  parseDateTime,
  toCalendarDateTime,
} from "@internationalized/date";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { KPIs } from "~/modules/production/production.models";

type ProductionEvent = {
  startTime: string;
  endTime: string;
  workCenterId: string;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
  });
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const start = String(searchParams.get("start"));
  const end = String(searchParams.get("end"));

  const startDate = toCalendarDateTime(parseDateTime(start));
  const endDate = toCalendarDateTime(parseDateTime(end));
  const currentDate = toCalendarDateTime(now("UTC"));

  const daysBetween = endDate.compare(startDate);

  // Calculate previous period dates
  const previousEnd = startDate;
  const previousStart = startDate.add({ days: -daysBetween });

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
            .order("startTime", { ascending: false })
            .order("endTime", { ascending: false }),
          client
            .from("productionEvent")
            .select("startTime, endTime, workCenterId")
            .eq("companyId", companyId)
            .gt("startTime", previousStart.toString())
            .or(`endTime.lte.${previousEnd.toString()},endTime.is.null`)
            .order("startTime", { ascending: false })
            .order("endTime", { ascending: false }),
        ]);

      const [groupedEvents, previousGroupedEvents] = [
        productionEvents.data ?? [],
        previousProductionEvents.data ?? [],
      ].map((events) =>
        events.reduce<Record<string, ProductionEvent[]>>((acc, event) => {
          if (!event.workCenterId) return acc;

          if (!acc[event.workCenterId]) {
            acc[event.workCenterId] = [];
          }

          acc[event.workCenterId].push({
            ...event,
            workCenterId: event.workCenterId!,
            endTime:
              event.endTime === null ? currentDate.toString() : event.endTime,
          });
          return acc;
        }, {})
      );

      const [data, previousPeriodData] = [
        groupedEvents,
        previousGroupedEvents,
      ].map((events) =>
        Object.entries(events)
          .map(([workCenterId, events]) => {
            const workCenter = workCenters.data?.find(
              (wc) => wc.id === workCenterId
            );
            if (!workCenter) return { key: workCenterId, value: 0 };

            // Sort events by start time, then end time if start times are equal
            const sortedEvents = [...events].sort((a, b) => {
              const aStart = new Date(a.startTime).getTime();
              const bStart = new Date(b.startTime).getTime();
              if (aStart !== bStart) return aStart - bStart;
              return (
                new Date(a.endTime).getTime() - new Date(b.endTime).getTime()
              );
            });

            let totalTime = 0;
            let lastEndTime: number | null = null;

            // Calculate non-overlapping time
            for (const event of sortedEvents) {
              const startTime = new Date(event.startTime).getTime();
              const endTime = new Date(event.endTime).getTime();

              if (lastEndTime === null) {
                totalTime += endTime - startTime;
              } else {
                // If this event starts after the last end time, add the full duration
                if (startTime > lastEndTime) {
                  totalTime += endTime - startTime;
                }
                // If this event overlaps but ends later, add the non-overlapping portion
                else if (endTime > lastEndTime) {
                  totalTime += endTime - lastEndTime;
                }
                // If this event is completely contained within the last event, skip it
              }

              // Update lastEndTime if this event ends later
              if (lastEndTime === null || endTime > lastEndTime) {
                lastEndTime = endTime;
              }
            }

            return {
              key: workCenter.name,
              value: totalTime,
            };
          })
          .sort((a, b) => b.value - a.value)
      );

      return json({
        data,
        previousPeriodData,
      });
    }
    case "estimatesVsActuals": {
      const jobs = await client
        .from("job")
        .select(
          "id, jobId, customerId, estimatedTime, actualTime, completedDate"
        )
        .eq("companyId", companyId)
        .gte("completedDate", start)
        .lte("completedDate", end)
        .not("completedDate", "is", null);

      if (jobs.error || !jobs.data || jobs.data.length === 0) {
        return json({
          data: [],
          previousPeriodData: [],
        });
      }

      const [jobOperations, productionEvents] = await Promise.all([
        client
          .from("jobOperation")
          .select("*")
          .in("jobId", jobs.data?.map((job) => job.id) ?? []),
        client
          .from("productionEvent")
          .select("*, ...jobOperation(jobId)")
          .eq("companyId", companyId)
          .in("jobOperation.jobId", jobs.data?.map((job) => job.id) ?? [])
          .not("jobOperation.jobId", "is", null),
      ]);

      console.log({ productionEvents: productionEvents.data });

      const jobOperationsByJobId = jobOperations.data?.reduce(
        (acc, operation) => {
          if (!acc[operation.jobId]) {
            acc[operation.jobId] = [];
          }
          acc[operation.jobId].push(operation);
          return acc;
        },
        {} as Record<string, typeof jobOperations.data>
      );

      return json({
        data: [],
        previousPeriodData: [],
      });
    }

    default:
      throw new Error(`Invalid KPI key: ${key}`);
  }
}
