import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { KPIs } from "~/modules/sales/sales.models";
import { months } from "~/modules/shared/shared.models";
import { groupDataByDay, groupDataByMonth } from "~/utils/chart";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const start = String(searchParams.get("start"));
  const end = String(searchParams.get("end"));

  const startDate = new Date(start);
  const endDate = new Date(end);

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
          .gt("orderDate", previousStartDate.toISOString().split("T")[0])
          .lte("orderDate", previousEndDate.toISOString().split("T")[0])
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
            start: previousStartDate.toISOString().split("T")[0],
            end: previousEndDate.toISOString().split("T")[0],
            groupBy: "orderDate",
          }),
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData,
        ].map((data: Record<string, any[]>) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value:
                kpi.key === "salesOrderRevenue"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

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
            start: previousStartDate.toISOString().split("T")[0],
            end: previousEndDate.toISOString().split("T")[0],
            groupBy: "orderDate",
          }),
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData,
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value:
                kpi.key === "salesOrderRevenue"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

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
          .gt("createdAt", previousStartDate.toISOString().split("T")[0])
          .lte("createdAt", previousEndDate.toISOString().split("T")[0])
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
              start: previousStartDate.toISOString().split("T")[0],
              end: previousEndDate.toISOString().split("T")[0],
              groupBy: "createdAt",
            }
          ),
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData,
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value: d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

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
              start: previousStartDate.toISOString().split("T")[0],
              end: previousEndDate.toISOString().split("T")[0],
              groupBy: "createdAt",
            }
          ),
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData,
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value: d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

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
          .gt("createdAt", previousStartDate.toISOString().split("T")[0])
          .lte("createdAt", previousEndDate.toISOString().split("T")[0])
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
              start: previousStartDate.toISOString().split("T")[0],
              end: previousEndDate.toISOString().split("T")[0],
              groupBy: "createdAt",
            }
          ),
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData,
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value: d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

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
              start: previousStartDate.toISOString().split("T")[0],
              end: previousEndDate.toISOString().split("T")[0],
              groupBy: "createdAt",
            }
          ),
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData,
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: months[Number(date.split("-")[1]) - 1],
              monthKey: date,
              value: d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

        return json({ data, previousPeriodData });
      }
    }

    default:
      throw new Error(`Invalid KPI key: ${key}`);
  }
}
