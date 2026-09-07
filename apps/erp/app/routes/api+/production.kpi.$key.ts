import { requirePermissions } from "@carbon/auth/auth.server";
import {
  now,
  parseDateTime,
  toCalendarDateTime
} from "@internationalized/date";
import type { LoaderFunctionArgs } from "react-router";
import { KPIs } from "~/modules/production/production.models";
import { getWorkCenterUtilization } from "~/modules/production/production.service";
import { makeDurations } from "~/utils/duration";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
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
    return {
      data: [],
      previousPeriodData: []
    };

  const kpi = KPIs.find((k) => k.key === key);
  if (!kpi)
    return {
      data: [],
      previousPeriodData: []
    };

  switch (kpi.key) {
    case "utilization": {
      return getWorkCenterUtilization(client, companyId, {
        start,
        end,
        previousStart: previousStart.toString(),
        previousEnd: previousEnd.toString(),
        currentDate: currentDate.toString()
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
        return {
          data: [],
          previousPeriodData: []
        };
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
      ]);

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

      const productionEventsByJobId = productionEvents.data?.reduce(
        (acc, event) => {
          if (!acc[event.jobId]) {
            acc[event.jobId] = [];
          }
          acc[event.jobId].push(event);
          return acc;
        },
        {} as Record<string, typeof productionEvents.data>
      );

      const data: {
        key: string;
        actual: number;
        estimate: number;
        difference: number;
      }[] = [];

      // Calculate totals for each job
      for (const job of jobs.data) {
        const jobId = job.id;

        // Calculate estimated time from job operations
        const operations = jobOperationsByJobId?.[jobId] || [];
        const estimatedTime = operations.reduce((total, operation) => {
          const withDurations = makeDurations(operation);
          return total + withDurations.duration;
        }, 0);

        // Calculate actual time from production events
        const events = productionEventsByJobId?.[jobId] || [];
        const actualTime = events.reduce((total, event) => {
          const startTime = new Date(event.startTime).getTime();
          const endTime = event.endTime
            ? new Date(event.endTime).getTime()
            : new Date().getTime();
          return total + (endTime - startTime);
        }, 0);

        data.push({
          key: job.jobId,
          actual: actualTime,
          estimate: estimatedTime,
          difference:
            estimatedTime === 0
              ? 0
              : (actualTime - estimatedTime) / estimatedTime
        });
      }

      return {
        data: data.sort((a, b) => a.difference - b.difference),
        previousPeriodData: []
      };
    }

    case "completionTime": {
      const [jobs, previousJobs] = await Promise.all([
        client
          .from("job")
          .select("id, jobId, secondsToComplete")
          .eq("companyId", companyId)
          .gte("completedDate", start)
          .lte("completedDate", end)
          .not("completedDate", "is", null)
          .not("releasedDate", "is", null),
        client
          .from("job")
          .select("id, jobId, secondsToComplete")
          .eq("companyId", companyId)
          .gte("completedDate", previousStart.toString())
          .lte("completedDate", previousEnd.toString())
          .not("completedDate", "is", null)
          .not("releasedDate", "is", null)
      ]);

      const [data, previousPeriodData] = [
        jobs.data ?? [],
        previousJobs.data ?? []
      ].map((jobs) =>
        jobs
          .map((job) => ({
            key: job.jobId,
            value: (job.secondsToComplete ?? 0) * 1000
          }))
          .sort((a, b) => b.value - a.value)
      );

      return {
        data,
        previousPeriodData
      };
    }
    default:
      throw new Error(`Invalid KPI key: ${key}`);
  }
}
