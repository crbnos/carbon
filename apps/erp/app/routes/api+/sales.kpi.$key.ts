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
    });

  const kpi = KPIs.find((k) => k.key === key);
  if (!kpi)
    return json({
      data: [],
    });

  switch (kpi.key) {
    case "salesOrderRevenue":
    case "salesOrderCount":
      const salesOrders = await client
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
        .order("orderDate", { ascending: false });

      if (daysBetween < 60) {
        const groupedData = groupDataByDay(salesOrders.data ?? [], {
          start,
          end,
          groupBy: "orderDate",
        });

        const data = Object.entries(groupedData)
          .map(([date, d]) => ({
            date,
            value:
              kpi.key === "salesOrderRevenue"
                ? d.reduce((sum, i) => {
                    return sum + (i.orderTotal ?? 0);
                  }, 0)
                : d.length,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        return json({
          data,
        });
      } else {
        const groupedData = groupDataByMonth(salesOrders.data ?? [], {
          start,
          end,
          groupBy: "orderDate",
        });

        const data = Object.entries(groupedData)
          .map(([date, d]) => ({
            month: months[Number(date.split("-")[1]) - 1],
            monthKey: date,
            value:
              kpi.key === "salesOrderRevenue"
                ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                : d.length,
          }))
          .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

        return json({
          data,
        });
      }

    case "quoteCount":
      const quotes = await client
        .from("quote")
        .select("createdAt", {
          count: "exact",
        })
        .eq("companyId", companyId)
        .in("status", ["Sent", "Ordered", "Partial", "Lost", "Expired"])
        .gt("createdAt", start)
        .lte("createdAt", end)
        .order("createdAt", { ascending: false });

      if (daysBetween < 60) {
        const groupedData = groupDataByDay(
          quotes.data?.map((q) => ({
            createdAt: q.createdAt.split("T")[0],
          })) ?? [],
          {
            start,
            end,
            groupBy: "createdAt",
          }
        );

        const data = Object.entries(groupedData)
          .map(([date, d]) => ({
            date,
            value: d.length,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        return json({ data });
      } else {
        const groupedData = groupDataByMonth(
          quotes.data?.map((q) => ({
            createdAt: q.createdAt.split("T")[0],
          })) ?? [],
          {
            start,
            end,
            groupBy: "createdAt",
          }
        );

        const data = Object.entries(groupedData)
          .map(([date, d]) => ({
            month: months[Number(date.split("-")[1]) - 1],
            monthKey: date,
            value: d.length,
          }))
          .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

        return json({ data });
      }

    case "rfqCount":
      const rfqs = await client
        .from("salesRfq")
        .select("createdAt", {
          count: "exact",
        })
        .eq("companyId", companyId)
        .in("status", ["Ready for Quote", "Quoted", "Closed"])
        .gt("createdAt", start)
        .lte("createdAt", end)
        .order("createdAt", { ascending: false });

      if (daysBetween < 60) {
        const groupedData = groupDataByDay(
          rfqs.data?.map((r) => ({
            createdAt: r.createdAt?.split("T")[0],
          })) ?? [],
          {
            start,
            end,
            groupBy: "createdAt",
          }
        );

        const data = Object.entries(groupedData)
          .map(([date, d]) => ({
            date,
            value: d.length,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        return json({ data });
      } else {
        const groupedData = groupDataByMonth(
          rfqs.data?.map((r) => ({
            createdAt: r.createdAt?.split("T")[0],
          })) ?? [],
          {
            start,
            end,
            groupBy: "createdAt",
          }
        );

        const data = Object.entries(groupedData)
          .map(([date, d]) => ({
            month: months[Number(date.split("-")[1]) - 1],
            monthKey: date,
            value: d.length,
          }))
          .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

        return json({ data });
      }

    case "turnaroundTime":
      return json({ data: [] });
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
