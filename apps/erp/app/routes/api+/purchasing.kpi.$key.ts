import { requirePermissions } from "@carbon/auth/auth.server";
import { getPreferenceHeaders } from "@carbon/remix";
import { parseDateTime, toCalendarDateTime } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { KPIs } from "~/modules/purchasing/purchasing.models";
import { groupDataByDay, groupDataByMonth } from "~/utils/chart";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { locale } = getPreferenceHeaders(request);
  const monthName = (dateKey: string) =>
    new Intl.DateTimeFormat(locale, { month: "long" }).format(
      new Date(2000, Number(dateKey.split("-")[1]) - 1)
    );
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const start = String(searchParams.get("start"));
  const end = String(searchParams.get("end"));
  const supplierId = searchParams.get("supplierId");

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

  const kpi = KPIs.find((k) => k.key === key);
  if (!kpi)
    return {
      data: [],
      previousPeriodData: []
    };

  switch (kpi.key) {
    case "purchaseOrderCount":
    case "purchaseOrderAmount": {
      const [orders, previousOrders] = await Promise.all([
        getPurchaseOrdersQuery(client, {
          companyId,
          supplierId,
          start,
          end
        }),
        getPurchaseOrdersQuery(client, {
          companyId,
          supplierId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        })
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(orders.data ?? [], {
            start,
            end,
            groupBy: "orderDate"
          }),
          groupDataByDay(previousOrders.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "orderDate"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value:
                kpi.key === "purchaseOrderAmount"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

        return { data, previousPeriodData };
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(orders.data ?? [], {
            start,
            end,
            groupBy: "orderDate"
          }),
          groupDataByMonth(previousOrders.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "orderDate"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: monthName(date),
              monthKey: date,
              value:
                kpi.key === "purchaseOrderAmount"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

        return { data, previousPeriodData };
      }
    }

    case "purchaseInvoiceCount":
    case "purchaseInvoiceAmount": {
      const [invoices, previousInvoices] = await Promise.all([
        getPurchaseInvoicesQuery(client, {
          companyId,
          supplierId,
          start,
          end
        }),
        getPurchaseInvoicesQuery(client, {
          companyId,
          supplierId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        })
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(invoices.data ?? [], {
            start,
            end,
            groupBy: "dateIssued"
          }),
          groupDataByDay(previousInvoices.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "dateIssued"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value:
                kpi.key === "purchaseInvoiceAmount"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

        return { data, previousPeriodData };
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(invoices.data ?? [], {
            start,
            end,
            groupBy: "dateIssued"
          }),
          groupDataByMonth(previousInvoices.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: "dateIssued"
          })
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: monthName(date),
              monthKey: date,
              value:
                kpi.key === "purchaseInvoiceAmount"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

        return { data, previousPeriodData };
      }
    }

    case "supplierQuoteCount": {
      const [quotes, previousQuotes] = await Promise.all([
        getSupplierQuotesQuery(client, {
          companyId,
          supplierId,
          start,
          end
        }),
        getSupplierQuotesQuery(client, {
          companyId,
          supplierId,
          start: previousStartDate.toString(),
          end: previousEndDate.toString()
        })
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(
            quotes.data?.map((q) => ({
              createdAt: q.createdAt
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt"
            }
          ),
          groupDataByDay(
            previousQuotes.data?.map((q) => ({
              createdAt: q.createdAt
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
              groupBy: "createdAt"
            }
          )
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value: d.length
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

        return { data, previousPeriodData };
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(
            quotes.data?.map((q) => ({
              createdAt: q.createdAt
            })) ?? [],
            {
              start,
              end,
              groupBy: "createdAt"
            }
          ),
          groupDataByMonth(
            previousQuotes.data?.map((q) => ({
              createdAt: q.createdAt
            })) ?? [],
            {
              start: previousStartDate.toString(),
              end: previousEndDate.toString(),
              groupBy: "createdAt"
            }
          )
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              month: monthName(date),
              monthKey: date,
              value: d.length
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

async function getPurchaseOrdersQuery(
  client: SupabaseClient,
  {
    companyId,
    supplierId,
    start,
    end
  }: {
    companyId: string;
    supplierId: string | null;
    start: string;
    end: string;
  }
) {
  let query = client
    .from("purchaseOrders")
    .select("orderTotal, orderDate", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .in("status", [
      "To Review",
      "To Receive",
      "To Invoice",
      "To Receive and Invoice",
      "Completed"
    ])
    .gte("orderDate", start)
    .lte("orderDate", end);

  if (supplierId) {
    query = query.eq("supplierId", supplierId);
  }

  query = query.order("orderDate", { ascending: false });

  return query;
}

async function getPurchaseInvoicesQuery(
  client: SupabaseClient,
  {
    companyId,
    supplierId,
    start,
    end
  }: {
    companyId: string;
    supplierId: string | null;
    start: string;
    end: string;
  }
) {
  let query = client
    .from("purchaseInvoices")
    .select("orderTotal, dateIssued", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .in("status", ["Pending", "Partially Paid", "Paid", "Open", "Overdue"])
    .gte("dateIssued", start)
    .lte("dateIssued", end);

  if (supplierId) {
    query = query.eq("supplierId", supplierId);
  }

  query = query.order("dateIssued", { ascending: false });

  return query;
}

async function getSupplierQuotesQuery(
  client: SupabaseClient,
  {
    companyId,
    supplierId,
    start,
    end
  }: {
    companyId: string;
    supplierId: string | null;
    start: string;
    end: string;
  }
) {
  const endWithTime = end.includes("T") ? end : `${end}T23:59:59`;
  let query = client
    .from("supplierQuote")
    .select("createdAt", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .gte("createdAt", start)
    .lte("createdAt", endWithTime);

  if (supplierId) {
    query = query.eq("supplierId", supplierId);
  }

  query = query.order("createdAt", { ascending: false });

  return query;
}
