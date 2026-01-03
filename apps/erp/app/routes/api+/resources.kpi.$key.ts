import { requirePermissions } from "@carbon/auth/auth.server";
import { parseDateTime, toCalendarDateTime } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type LoaderFunctionArgs } from "react-router";
import { MaintenanceKPIs } from "~/modules/resources/resources.models";
import { months } from "~/modules/shared/shared.models";
import { groupDataByDay, groupDataByMonth } from "~/utils/chart";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources"
  });
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const start = String(searchParams.get("start"));
  const end = String(searchParams.get("end"));
  const workCenterId = searchParams.get("workCenterId");

  const startDate = toCalendarDateTime(parseDateTime(start));
  const endDate = toCalendarDateTime(parseDateTime(end));

  const daysBetween = endDate.compare(startDate);

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
    return {
      data: [],
      previousPeriodData: []
    };

  const kpi = MaintenanceKPIs.find((k) => k.key === key);
  if (!kpi)
    return {
      data: [],
      previousPeriodData: []
    };

  switch (kpi.key) {
    case "mttr": {
      // MTTR = Sum of repair durations / Number of repairs (per period)
      // duration = actualEndTime - actualStartTime (stored in seconds)
      const [dispatches, previousDispatches] = await Promise.all([
        getCompletedDispatchesQuery(client, {
          companyId,
          workCenterId,
          start,
          end
        }),
        getCompletedDispatchesQuery(client, {
          companyId,
          workCenterId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        })
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(dispatches.data ?? [], {
            start,
            end,
            groupBy: "completedAt"
          }),
          groupDataByDay(previousDispatches.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "completedAt"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data: Record<string, any[]>) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value:
                d.length > 0
                  ? d.reduce((sum, i) => sum + (i.duration ?? 0), 0) / d.length
                  : 0
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

        return { data, previousPeriodData };
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(dispatches.data ?? [], {
            start,
            end,
            groupBy: "completedAt"
          }),
          groupDataByMonth(previousDispatches.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "completedAt"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value:
                d.length > 0
                  ? d.reduce((sum, i) => sum + (i.duration ?? 0), 0) / d.length
                  : 0
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

        return { data, previousPeriodData };
      }
    }

    case "mtbf": {
      // MTBF = Total operating time / Number of failures (per period)
      const [
        productionEvents,
        failures,
        previousProductionEvents,
        previousFailures
      ] = await Promise.all([
        getProductionEventsQuery(client, {
          companyId,
          workCenterId,
          start,
          end
        }),
        getReactiveDispatchesQuery(client, {
          companyId,
          workCenterId,
          start,
          end
        }),
        getProductionEventsQuery(client, {
          companyId,
          workCenterId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        }),
        getReactiveDispatchesQuery(client, {
          companyId,
          workCenterId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        })
      ]);

      if (daysBetween < 60) {
        // Group production events by day (using startTime)
        const [groupedEvents, previousGroupedEvents] = [
          groupDataByDay(productionEvents.data ?? [], {
            start,
            end,
            groupBy: "startTime"
          }),
          groupDataByDay(previousProductionEvents.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "startTime"
          })
        ];

        // Group failures by day (using createdAt)
        const [groupedFailures, previousGroupedFailures] = [
          groupDataByDay(failures.data ?? [], {
            start,
            end,
            groupBy: "createdAt"
          }),
          groupDataByDay(previousFailures.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "createdAt"
          })
        ];

        // Calculate MTBF per day
        const calculateMtbfByDay = (
          events: Record<string, any[]>,
          failures: Record<string, any[]>
        ) => {
          const allDates = new Set([
            ...Object.keys(events),
            ...Object.keys(failures)
          ]);
          return Array.from(allDates)
            .map((date) => {
              const dayEvents = events[date] ?? [];
              const dayFailures = failures[date] ?? [];
              const operatingTime = dayEvents.reduce(
                (sum, e) => sum + (e.duration ?? 0),
                0
              );
              const failureCount = dayFailures.length;
              return {
                date,
                value: failureCount > 0 ? operatingTime / failureCount : 0
              };
            })
            .sort((a, b) => a.date.localeCompare(b.date));
        };

        const data = calculateMtbfByDay(groupedEvents, groupedFailures);
        const previousPeriodData = calculateMtbfByDay(
          previousGroupedEvents,
          previousGroupedFailures
        );

        return { data, previousPeriodData };
      } else {
        // Group production events by month
        const [groupedEvents, previousGroupedEvents] = [
          groupDataByMonth(productionEvents.data ?? [], {
            start,
            end,
            groupBy: "startTime"
          }),
          groupDataByMonth(previousProductionEvents.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "startTime"
          })
        ];

        // Group failures by month
        const [groupedFailures, previousGroupedFailures] = [
          groupDataByMonth(failures.data ?? [], {
            start,
            end,
            groupBy: "createdAt"
          }),
          groupDataByMonth(previousFailures.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "createdAt"
          })
        ];

        // Calculate MTBF per month
        const calculateMtbfByMonth = (
          events: Record<string, any[]>,
          failures: Record<string, any[]>
        ) => {
          const allMonths = new Set([
            ...Object.keys(events),
            ...Object.keys(failures)
          ]);
          return Array.from(allMonths)
            .map((monthKey) => {
              const monthEvents = events[monthKey] ?? [];
              const monthFailures = failures[monthKey] ?? [];
              const operatingTime = monthEvents.reduce(
                (sum, e) => sum + (e.duration ?? 0),
                0
              );
              const failureCount = monthFailures.length;
              return {
                month: months[Number(monthKey.split("-")[1]) - 1],
                monthKey,
                value: failureCount > 0 ? operatingTime / failureCount : 0
              };
            })
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
        };

        const data = calculateMtbfByMonth(groupedEvents, groupedFailures);
        const previousPeriodData = calculateMtbfByMonth(
          previousGroupedEvents,
          previousGroupedFailures
        );

        return { data, previousPeriodData };
      }
    }

    case "sparePartCost": {
      const [items, previousItems] = await Promise.all([
        getDispatchItemsQuery(client, {
          companyId,
          workCenterId,
          start,
          end
        }),
        getDispatchItemsQuery(client, {
          companyId,
          workCenterId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        })
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(items.data ?? [], {
            start,
            end,
            groupBy: "completedAt"
          }),
          groupDataByDay(previousItems.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "completedAt"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data: Record<string, any[]>) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value: d.reduce((sum, i) => sum + (i.totalCost ?? 0), 0)
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

        return { data, previousPeriodData };
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(items.data ?? [], {
            start,
            end,
            groupBy: "completedAt"
          }),
          groupDataByMonth(previousItems.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "completedAt"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value: d.reduce((sum, i) => sum + (i.totalCost ?? 0), 0)
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

        return { data, previousPeriodData };
      }
    }

    case "worstPerformingMachines": {
      const [dispatches, previousDispatches] = await Promise.all([
        getReactiveDispatchesByWorkCenterQuery(client, {
          companyId,
          start,
          end
        }),
        getReactiveDispatchesByWorkCenterQuery(client, {
          companyId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        })
      ]);

      // Group by work center and count failures
      const countByWorkCenter = (data: any[]) => {
        const counts: Record<string, { name: string; count: number }> = {};
        data.forEach((d) => {
          if (!d.workCenterId || !d.workCenter?.name) return;
          if (!counts[d.workCenterId]) {
            counts[d.workCenterId] = { name: d.workCenter.name, count: 0 };
          }
          counts[d.workCenterId].count++;
        });
        return Object.values(counts)
          .map((c) => ({ name: c.name, value: c.count }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10); // Top 10 worst performers
      };

      const data = countByWorkCenter(dispatches.data ?? []);
      const previousPeriodData = countByWorkCenter(
        previousDispatches.data ?? []
      );

      return { data, previousPeriodData };
    }

    case "sparePartConsumption": {
      const [items, previousItems] = await Promise.all([
        getDispatchItemsQuery(client, {
          companyId,
          workCenterId,
          start,
          end
        }),
        getDispatchItemsQuery(client, {
          companyId,
          workCenterId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        })
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(items.data ?? [], {
            start,
            end,
            groupBy: "completedAt"
          }),
          groupDataByDay(previousItems.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "completedAt"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data: Record<string, any[]>) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value: d.reduce((sum, i) => sum + (i.quantity ?? 0), 0)
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

        return { data, previousPeriodData };
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(items.data ?? [], {
            start,
            end,
            groupBy: "completedAt"
          }),
          groupDataByMonth(previousItems.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "completedAt"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value: d.reduce((sum, i) => sum + (i.quantity ?? 0), 0)
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

        return { data, previousPeriodData };
      }
    }

    default:
      throw new Error(`Invalid KPI key: ${key}`);
  }
}

async function getCompletedDispatchesQuery(
  client: SupabaseClient,
  {
    companyId,
    workCenterId,
    start,
    end
  }: {
    companyId: string;
    workCenterId: string | null;
    start: string;
    end: string;
  }
) {
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;

  let query = client
    .from("maintenanceDispatch")
    .select("id, duration, completedAt")
    .eq("companyId", companyId)
    .eq("status", "Completed")
    .not("completedAt", "is", null)
    .gte("completedAt", start)
    .lte("completedAt", endWithTime);

  if (workCenterId) {
    query = query.eq("workCenterId", workCenterId);
  }

  return query.order("completedAt", { ascending: false });
}

async function getReactiveDispatchesQuery(
  client: SupabaseClient,
  {
    companyId,
    workCenterId,
    start,
    end
  }: {
    companyId: string;
    workCenterId: string | null;
    start: string;
    end: string;
  }
) {
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;

  let query = client
    .from("maintenanceDispatch")
    .select("id, workCenterId, createdAt")
    .eq("companyId", companyId)
    .eq("source", "Reactive")
    .gte("createdAt", start)
    .lte("createdAt", endWithTime);

  if (workCenterId) {
    query = query.eq("workCenterId", workCenterId);
  }

  return query.order("createdAt", { ascending: true });
}

async function getProductionEventsQuery(
  client: SupabaseClient,
  {
    companyId,
    workCenterId,
    start,
    end
  }: {
    companyId: string;
    workCenterId: string | null;
    start: string;
    end: string;
  }
) {
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;

  let query = client
    .from("productionEvent")
    .select("id, duration, workCenterId, startTime")
    .eq("companyId", companyId)
    .not("endTime", "is", null)
    .gte("startTime", start)
    .lte("startTime", endWithTime);

  if (workCenterId) {
    query = query.eq("workCenterId", workCenterId);
  }

  return query;
}

async function getReactiveDispatchesByWorkCenterQuery(
  client: SupabaseClient,
  {
    companyId,
    start,
    end
  }: {
    companyId: string;
    start: string;
    end: string;
  }
) {
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;

  return client
    .from("maintenanceDispatch")
    .select("id, workCenterId, workCenter:workCenterId(name), createdAt")
    .eq("companyId", companyId)
    .eq("source", "Reactive")
    .not("workCenterId", "is", null)
    .gte("createdAt", start)
    .lte("createdAt", endWithTime)
    .order("createdAt", { ascending: false });
}

async function getDispatchItemsQuery(
  client: SupabaseClient,
  {
    companyId,
    workCenterId,
    start,
    end
  }: {
    companyId: string;
    workCenterId: string | null;
    start: string;
    end: string;
  }
) {
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;

  // Get items from completed dispatches
  let query = client
    .from("maintenanceDispatchItem")
    .select(
      `
      id,
      quantity,
      totalCost,
      maintenanceDispatch:maintenanceDispatchId(
        id,
        workCenterId,
        completedAt
      )
    `
    )
    .eq("companyId", companyId);

  const result = await query;

  // Filter by date and work center in JavaScript since we need to filter on joined table
  const filtered =
    result.data?.filter((item) => {
      const dispatch = item.maintenanceDispatch as any;
      if (!dispatch?.completedAt) return false;
      if (dispatch.completedAt < start || dispatch.completedAt > endWithTime)
        return false;
      if (workCenterId && dispatch.workCenterId !== workCenterId) return false;
      return true;
    }) ?? [];

  // Flatten the data to include completedAt at top level for grouping
  const flattenedData = filtered.map((item) => ({
    ...item,
    completedAt: (item.maintenanceDispatch as any)?.completedAt
  }));

  return { data: flattenedData };
}
