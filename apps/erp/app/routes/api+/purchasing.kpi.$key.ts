import { requirePermissions } from "@carbon/auth/auth.server";
import { parseDateTime, toCalendarDateTime } from "@internationalized/date";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { KPIs } from "~/modules/purchasing/purchasing.models";
import { months } from "~/modules/shared/shared.models";
import { groupDataByDay, groupDataByMonth } from "~/utils/chart";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
  });
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const start = String(searchParams.get("start"));
  const end = String(searchParams.get("end"));

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
    case "purchaseOrderCount":
    case "purchaseOrderAmount": {
      const [orders, previousOrders] = await Promise.all([
        client
          .from("purchaseOrders")
          .select("orderTotal, orderDate", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", [
            "To Review",
            "To Receive",
            "To Invoice",
            "To Receive and Invoice",
            "Completed",
          ])
          .gt("orderDate", start)
          .lte("orderDate", end)
          .order("orderDate", { ascending: false }),
        client
          .from("purchaseOrders")
          .select("orderTotal, orderDate", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", [
            "To Review",
            "To Receive",
            "To Invoice",
            "To Receive and Invoice",
            "Completed",
          ])
          .gt("orderDate", previousStartDate.toString())
          .lte("orderDate", previousEndDate.toString())
          .order("orderDate", { ascending: false }),
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(orders.data ?? [], {
            start,
            end,
            groupBy: "orderDate",
          }),
          groupDataByDay(previousOrders.data ?? [], {
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
              date,
              value:
                kpi.key === "purchaseOrderAmount"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

        return json({ data, previousPeriodData });
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(orders.data ?? [], {
            start,
            end,
            groupBy: "orderDate",
          }),
          groupDataByMonth(previousOrders.data ?? [], {
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
                kpi.key === "purchaseOrderAmount"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

        return json({ data, previousPeriodData });
      }
    }

    case "purchaseInvoiceCount":
    case "purchaseInvoiceAmount": {
      const dateField = "dateIssued";
      const [invoices, previousInvoices] = await Promise.all([
        client
          .from("purchaseInvoices")
          .select("orderTotal, dateIssued", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", [
            "Pending",
            "Partially Paid",
            "Paid",
            "Submitted",
            "Overdue",
          ])
          .gt(dateField, start)
          .lte(dateField, end)
          .order(dateField, { ascending: false }),
        client
          .from("purchaseInvoices")
          .select("orderTotal, dateIssued", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .in("status", [
            "Pending",
            "Partially Paid",
            "Paid",
            "Submitted",
            "Overdue",
          ])
          .gt(dateField, previousStartDate.toString())
          .lte(dateField, previousEndDate.toString())
          .order(dateField, { ascending: false }),
      ]);

      if (daysBetween < 60) {
        const [groupedData, previousGroupedData] = [
          groupDataByDay(invoices.data ?? [], {
            start,
            end,
            groupBy: dateField,
          }),
          groupDataByDay(previousInvoices.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: dateField,
          }),
        ];

        const [data, previousPeriodData] = [
          groupedData,
          previousGroupedData,
        ].map((data) =>
          Object.entries(data)
            .map(([date, d]) => ({
              date,
              value:
                kpi.key === "purchaseInvoiceAmount"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length,
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );

        return json({ data, previousPeriodData });
      } else {
        const [groupedData, previousGroupedData] = [
          groupDataByMonth(invoices.data ?? [], {
            start,
            end,
            groupBy: dateField,
          }),
          groupDataByMonth(previousInvoices.data ?? [], {
            start: previousStartDate.toString(),
            end: previousEndDate.toString(),
            groupBy: dateField,
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
                kpi.key === "purchaseInvoiceAmount"
                  ? d.reduce((sum, i) => sum + (i.orderTotal ?? 0), 0)
                  : d.length,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        );

        return json({ data, previousPeriodData });
      }
    }

    case "supplierQuoteCount": {
      const [quotes, previousQuotes] = await Promise.all([
        client
          .from("supplierQuote")
          .select("createdAt", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .gt("createdAt", start)
          .lte("createdAt", end)
          .order("createdAt", { ascending: false }),
        client
          .from("supplierQuote")
          .select("createdAt", {
            count: "exact",
          })
          .eq("companyId", companyId)
          .gt("createdAt", previousStartDate.toString())
          .lte("createdAt", previousEndDate.toString())
          .order("createdAt", { ascending: false }),
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

    default:
      throw new Error(`Invalid KPI key: ${key}`);
  }
}
