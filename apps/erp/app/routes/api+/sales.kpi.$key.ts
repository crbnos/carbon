import { requirePermissions } from "@carbon/auth/auth.server";
import { parseDateTime, toCalendarDateTime } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  const customerId = searchParams.get("customerId");

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
    case "salesFunnel": {
      const [salesOrders, quotes, rfqs, previousSalesOrders] =
        await Promise.all([
          getSalesOrdersQuery(client, {
            companyId,
            customerId,
            start,
            end,
          }),
          getQuotesQuery(client, {
            companyId,
            customerId,
            start,
            end,
          }),
          getRfqQuery(client, {
            companyId,
            customerId,
            start,
            end,
          }),
          getSalesOrdersQuery(client, {
            companyId,
            customerId,
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
          }),
        ]);

      const data = [
        {
          name: "RFQs",
          value: rfqs.count ?? 0,
        },
        {
          name: "Quotes",
          value: quotes.count ?? 0,
        },
        {
          name: "Sales Orders",
          value: salesOrders.count ?? 0,
        },
        {
          name: "Revenue",
          value:
            salesOrders.data?.reduce(
              (sum, order) => sum + (order.orderTotal ?? 0),
              0
            ) ?? 0,
        },
      ];

      const previousPeriodData = [
        {
          name: "Revenue",
          value:
            previousSalesOrders.data?.reduce(
              (sum, order) => sum + (order.orderTotal ?? 0),
              0
            ) ?? 0,
        },
      ];

      return json({
        data,
        previousPeriodData,
      });
    }

    case "salesOrderRevenue":
    case "salesOrderCount": {
      const [salesOrders, previousSalesOrders] = await Promise.all([
        getSalesOrdersQuery(client, {
          companyId,
          customerId,
          start,
          end,
        }),
        getSalesOrdersQuery(client, {
          companyId,
          customerId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString(),
        }),
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
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
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
        getQuotesQuery(client, {
          companyId,
          customerId,
          start,
          end,
        }),
        getQuotesQuery(client, {
          companyId,
          customerId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString(),
        }),
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(
            quotes.data?.map((q) => ({
              createdAt: q.createdAt,
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt",
            }
          ),
          groupDataByDay(
            previousQuotes.data?.map((q) => ({
              createdAt: q.createdAt,
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
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
              createdAt: q.createdAt,
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt",
            }
          ),
          groupDataByMonth(
            previousQuotes.data?.map((q) => ({
              createdAt: q.createdAt,
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
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
        getRfqQuery(client, {
          companyId,
          customerId,
          start,
          end,
        }),
        getRfqQuery(client, {
          companyId,
          customerId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString(),
        }),
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(
            rfqs.data?.map((r) => ({
              createdAt: r.createdAt,
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt",
            }
          ),
          groupDataByDay(
            previousRfqs.data?.map((r) => ({
              createdAt: r.createdAt,
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
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
              createdAt: r.createdAt,
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt",
            }
          ),
          groupDataByMonth(
            previousRfqs.data?.map((r) => ({
              createdAt: r.createdAt,
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
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

async function getSalesOrdersQuery(
  client: SupabaseClient,
  {
    companyId,
    customerId,
    start,
    end,
  }: {
    companyId: string;
    customerId: string | null;
    start: string;
    end: string;
  }
) {
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;

  let query = client
    .from("salesOrders")
    .select("orderTotal, orderDate", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .in("status", [
      "In Progress",
      "Needs Approval",
      "To Ship and Invoice",
      "To Ship",
      "To Invoice",
      "Confirmed",
      "Completed",
      "Invoiced",
    ])
    .gt("orderDate", start)
    .lte("orderDate", endWithTime);

  if (customerId) {
    query = query.eq("customerId", customerId);
  }

  query = query.order("orderDate", { ascending: false });

  return query;
}

async function getQuotesQuery(
  client: SupabaseClient,
  {
    companyId,
    customerId,
    start,
    end,
  }: {
    companyId: string;
    customerId: string | null;
    start: string;
    end: string;
  }
) {
  // Add time to end date if not present
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;

  let query = client
    .from("quote")
    .select("createdAt", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .in("status", ["Sent", "Ordered", "Partial", "Lost", "Expired"])
    .gt("createdAt", start)
    .lte("createdAt", endWithTime);

  if (customerId) {
    query = query.eq("customerId", customerId);
  }

  query = query.order("createdAt", { ascending: false });

  return query;
}

async function getRfqQuery(
  client: SupabaseClient,
  {
    companyId,
    customerId,
    start,
    end,
  }: {
    companyId: string;
    customerId: string | null;
    start: string;
    end: string;
  }
) {
  // Add time to end date if not present
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;

  let query = client
    .from("salesRfq")
    .select("createdAt", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .in("status", ["Ready for Quote", "Quoted", "Closed"])
    .gt("createdAt", start)
    .lte("createdAt", endWithTime);

  if (customerId) {
    query = query.eq("customerId", customerId);
  }

  query = query.order("createdAt", { ascending: false });

  return query;
}
