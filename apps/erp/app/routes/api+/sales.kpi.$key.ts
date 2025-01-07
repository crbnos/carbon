import { requirePermissions } from "@carbon/auth/auth.server";
import { parseDate } from "@internationalized/date";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { KPIs } from "~/modules/sales/sales.models";
import { months } from "~/modules/shared/shared.models";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const start = String(searchParams.get("start"));
  const end = String(searchParams.get("end"));

  const startDate = parseDate(start);
  const endDate = parseDate(end);

  const daysBetween = endDate.compare(startDate);

  // Calculate previous period dates
  const previousEndDate = startDate;
  const previousStartDate = previousEndDate.subtract({ days: daysBetween });

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
    case "salesOrderRevenue":
    case "salesOrderCount": {
      const [salesOrders, previousSalesOrders] = await Promise.all([
        client
          .from("salesOrders")
          .select("orderTotal, orderDate", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", [
            "In Progress",
            "Needs Approval",
            "Confirmed",
            "Completed",
            "Invoiced",
          ])
          .gt("orderDate", start)
          .lte("orderDate", end)
          .order("orderDate", { ascending: false }),
        client
          .from("salesOrders")
          .select("orderTotal, orderDate", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", [
            "In Progress",
            "Needs Approval",
            "Confirmed",
            "Completed",
            "Invoiced",
          ])
          .gt("orderDate", previousStartDate.toString())
          .lte("orderDate", previousEndDate.toString())
          .order("orderDate", { ascending: false }),
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(salesOrders.data ?? [], {
            start,
            end,
            groupBy: "orderDate",
          }),
          groupDataByDay(previousSalesOrders.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "orderDate",
          }),
        ];

        const [data, previousPeriodData] = [
          Object.entries(groupedData)
            .map(([date, d]) => ({
              date,
              value:
                kpi.key === "salesOrderRevenue"
                  ? d.reduce((sum, i) => {
                      return sum + (i.orderTotal ?? 0);
                    }, 0)
                  : d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
          Object.entries(previousGroupedData)
            .map(([date, d]) => ({
              date,
              value:
                kpi.key === "salesOrderRevenue"
                  ? d.reduce((sum, i) => {
                      return sum + (i.orderTotal ?? 0);
                    }, 0)
                  : d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        ];

        return json({
          data,
          previousPeriodData,
        });
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(salesOrders.data ?? [], {
            start,
            end,
            groupBy: "orderDate",
          }),
          groupDataByMonth(previousSalesOrders.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "orderDate",
          }),
        ];

        const [data, previousPeriodData] = [
          Object.entries(groupedData)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value:
                kpi.key === "salesOrderRevenue"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
          Object.entries(previousGroupedData)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value:
                kpi.key === "salesOrderRevenue"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
        ];

        return json({
          data,
          previousPeriodData,
        });
      }
    }

    case "quoteCount": {
      const [quotes, previousQuotes] = await Promise.all([
        client
          .from("quote")
          .select("createdAt", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", ["Sent", "Ordered", "Partial", "Lost", "Expired"])
          .gt("createdAt", start)
          .lte("createdAt", end)
          .order("createdAt", { ascending: false }),
        client
          .from("quote")
          .select("createdAt", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", ["Sent", "Ordered", "Partial", "Lost", "Expired"])
          .gt("createdAt", previousStartDate.toString())
          .lte("createdAt", previousEndDate.toString())
          .order("createdAt", { ascending: false }),
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(
            quotes.data?.map((q) => ({
              createdAt: q.createdAt.split("T")[0],
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt",
            }
          ),
          groupDataByDay(
            previousQuotes.data?.map((q) => ({
              createdAt: q.createdAt.split("T")[0],
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
              groupBy: "createdAt",
            }
          ),
        ];

        const [data, previousPeriodData] = [
          Object.entries(groupedData)
            .map(([date, d]) => ({
              date,
              value: d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
          Object.entries(previousGroupedData)
            .map(([date, d]) => ({
              date,
              value: d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        ];

        return json({ data, previousPeriodData });
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(
            quotes.data?.map((q) => ({
              createdAt: q.createdAt.split("T")[0],
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt",
            }
          ),
          groupDataByMonth(
            previousQuotes.data?.map((q) => ({
              createdAt: q.createdAt.split("T")[0],
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
              groupBy: "createdAt",
            }
          ),
        ];

        const [data, previousPeriodData] = [
          Object.entries(groupedData)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value: d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
          Object.entries(previousGroupedData)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value: d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
        ];

        return json({ data, previousPeriodData });
      }
    }

    case "rfqCount": {
      const [rfqs, previousRfqs] = await Promise.all([
        client
          .from("salesRfq")
          .select("createdAt", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", ["Ready for Quote", "Quoted", "Closed"])
          .gt("createdAt", start)
          .lte("createdAt", end)
          .order("createdAt", { ascending: false }),
        client
          .from("salesRfq")
          .select("createdAt", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", ["Ready for Quote", "Quoted", "Closed"])
          .gt("createdAt", previousStartDate.toString())
          .lte("createdAt", previousEndDate.toString())
          .order("createdAt", { ascending: false }),
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(
            rfqs.data?.map((r) => ({
              createdAt: r.createdAt?.split("T")[0],
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt",
            }
          ),
          groupDataByDay(
            previousRfqs.data?.map((r) => ({
              createdAt: r.createdAt?.split("T")[0],
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
              groupBy: "createdAt",
            }
          ),
        ];

        const [data, previousPeriodData] = [
          Object.entries(groupedData)
            .map(([date, d]) => ({
              date,
              value: d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
          Object.entries(previousGroupedData)
            .map(([date, d]) => ({
              date,
              value: d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        ];

        return json({ data, previousPeriodData });
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(
            rfqs.data?.map((r) => ({
              createdAt: r.createdAt?.split("T")[0],
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt",
            }
          ),
          groupDataByMonth(
            previousRfqs.data?.map((r) => ({
              createdAt: r.createdAt?.split("T")[0],
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
              groupBy: "createdAt",
            }
          ),
        ];

        const [data, previousPeriodData] = [
          Object.entries(groupedData)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value: d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
          Object.entries(previousGroupedData)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value: d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
        ];

        return json({ data, previousPeriodData });
      }
    }

    default:
      throw new Error("Invalid KPI key");
  }
}

function groupDataByDay<T extends object>(
  data: T[],
  args: {
    start: string;
    end: string;
    groupBy: keyof T;
  }
): Record<string, T[]> {
  const { start, end, groupBy } = args;

  const result: Record<string, T[]> = {};

  let d = parseDate(start);
  let e = parseDate(end);

  if (d > e) return {};

  while (d <= e) {
    const date = d.toString();
    result[date] = [];
    d = d.add({ days: 1 });
  }

  data.forEach((d) => {
    const date = d[groupBy]!.toString();
    result[date].push(d);
  });

  return result;
}

function groupDataByMonth<T extends object>(
  data: T[],
  args: {
    start: string;
    end: string;
    groupBy: keyof T;
  }
): Record<string, T[]> {
  const { start, end, groupBy } = args;

  const result: Record<string, T[]> = {};

  let d = parseDate(start);
  let e = parseDate(end);

  if (d > e) return {};

  while (d <= e) {
    // Format as YYYY-MM
    const monthKey = `${d.year}-${String(d.month).padStart(2, "0")}`;
    result[monthKey] = [];
    d = d.add({ months: 1 });
  }

  data.forEach((item) => {
    const date = parseDate(item[groupBy]!.toString());
    const monthKey = `${date.year}-${String(date.month).padStart(2, "0")}`;
    if (result[monthKey]) {
      result[monthKey].push(item);
    }
  });

  return result;
}
