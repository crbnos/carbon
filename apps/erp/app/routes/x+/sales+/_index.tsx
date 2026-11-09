// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DateRange } from "@react-types/datepicker";
import { useMemo } from "react";
import {
  LuChartNoAxesCombined,
  LuFileText,
  LuPackageOpen,
  LuReceiptText
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis
} from "recharts";
import { DateSelect, Empty, Hyperlink, MetricCard } from "~/components";
import { CSVLink } from "~/components/CSVLink";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { useQuantityFormatter } from "~/hooks/useQuantityFormatter";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, { view: "sales" });
  const url = new URL(request.url);
  const api = carbonFor(auth);
  const result = await api.sales.getSalesDashboardAnalytics({
    startDate: url.searchParams.get("start") ?? undefined,
    endDate: url.searchParams.get("end") ?? undefined,
    customerId: url.searchParams.get("customerId")
  });
  if (result.error || !result.data) {
    throw new Response(
      result.error?.message ?? "Could not load sales analytics",
      {
        status: result.error?.status ?? 500
      }
    );
  }
  return result.data;
}

export default function SalesDashboard() {
  const { t } = useLingui();
  const report = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [customers] = useCustomers();
  const currency = useCurrencyFormatter();
  const compactCurrency = useCurrencyFormatter({ compact: true });
  const formatCount = useQuantityFormatter();
  const customerId = searchParams.get("customerId") ?? "all";
  const interval =
    searchParams.get("interval") ??
    (searchParams.has("start") || searchParams.has("end") ? "custom" : "month");
  const dateRange: DateRange = {
    start: parseDate(report.startDate),
    end: parseDate(report.endDate)
  };

  const customerOptions = useMemo(
    () => [
      { label: t`All Customers`, value: "all" },
      ...customers.map((customer) => ({
        label: customer.name,
        value: customer.id
      }))
    ],
    [customers, t]
  );
  const periodOptions = [
    { value: "week", label: t`7D` },
    { value: "month", label: t`MTD` },
    { value: "quarter", label: t`90D` },
    { value: "year", label: t`1Y` }
  ];

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next);
  };

  const onIntervalChange = (value: string) => {
    if (value === "custom") {
      updateParams({ interval: value });
      return;
    }
    const end = parseDate(report.asOfDate);
    const start =
      value === "week"
        ? end.subtract({ days: 6 })
        : value === "quarter"
          ? end.subtract({ days: 89 })
          : value === "year"
            ? end.subtract({ years: 1 })
            : end.set({ day: 1 });
    updateParams({
      interval: value,
      start: start.toString(),
      end: end.toString()
    });
  };

  const onDateRangeChange = (range: DateRange | null) => {
    updateParams({
      interval: "custom",
      start: range?.start.toString() ?? null,
      end: range?.end.toString() ?? null
    });
  };

  const revenue = report.revenue;
  const invoiceSales =
    revenue?.daily.reduce((total, row) => total + row.invoiceSales, 0) ?? 0;
  const credits =
    revenue?.daily.reduce((total, row) => total + row.credits, 0) ?? 0;
  const netSales = invoiceSales - credits;
  const periodLabel = `${formatDate(report.startDate)} – ${formatDate(report.endDate)}`;

  const chartData = useMemo(() => {
    if (!revenue) return [];
    const byDay = new Map(revenue.daily.map((row) => [row.day, row]));
    const start = parseDate(report.startDate);
    const end = parseDate(report.endDate);
    const monthly = start.compare(end.subtract({ days: 60 })) < 0;
    const points = new Map<
      string,
      {
        period: string;
        invoiceSales: number;
        credits: number;
        netSales: number;
      }
    >();
    for (let day = start; day.compare(end) <= 0; day = day.add({ days: 1 })) {
      const key = monthly ? day.toString().slice(0, 7) : day.toString();
      const value = byDay.get(day.toString());
      const point = points.get(key) ?? {
        period: monthly
          ? formatDate(`${key}-01`, { month: "short", year: "numeric" })
          : formatDate(key, { month: "short", day: "numeric" }),
        invoiceSales: 0,
        credits: 0,
        netSales: 0
      };
      point.invoiceSales += value?.invoiceSales ?? 0;
      point.credits -= value?.credits ?? 0;
      point.netSales = point.invoiceSales + point.credits;
      points.set(key, point);
    }
    return [...points.values()];
  }, [revenue, report.startDate, report.endDate]);

  const chartConfig = {
    invoiceSales: { label: t`Invoices`, color: "hsl(var(--primary))" },
    credits: { label: t`Credits`, color: "hsl(var(--destructive))" },
    netSales: { label: t`Net sales`, color: "hsl(var(--muted-foreground))" }
  } satisfies ChartConfig;
  const csvData = [
    [t`Date`, t`Invoices`, t`Credits`, t`Net sales`],
    ...(revenue?.daily.map((row) => [
      row.day,
      row.invoiceSales,
      -row.credits,
      row.invoiceSales - row.credits
    ]) ?? [])
  ];
  const backlogOrders = (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Largest open orders</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {report.backlog.orders.length ? (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Order</Trans>
                </Th>
                <Th>
                  <Trans>Customer</Trans>
                </Th>
                <Th>
                  <Trans>Uninvoiced merchandise</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {report.backlog.orders.map((order) => (
                <Tr key={order.id}>
                  <Td>
                    <Hyperlink to={path.to.salesOrder(order.id)}>
                      {order.salesOrderId}
                    </Hyperlink>
                  </Td>
                  <Td>{order.customerName}</Td>
                  <Td>{currency.format(order.amount)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : (
          <Empty />
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex h-[calc(100dvh-var(--header-height))] w-full flex-col gap-4 overflow-y-auto bg-card p-4">
      <h1 className="sr-only">
        <Trans>Sales Dashboard</Trans>
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        {revenue && (
          <DateSelect
            value={interval}
            onValueChange={onIntervalChange}
            options={periodOptions}
            dateRange={dateRange}
            onDateRangeChange={onDateRangeChange}
          />
        )}
        <Combobox
          asButton
          aria-label={t`Customer`}
          value={customerId}
          onChange={(value) =>
            updateParams({ customerId: value === "all" ? null : value })
          }
          options={customerOptions}
          size="sm"
          className="min-w-[160px]"
        />
        {revenue && (
          <Button asChild variant="secondary" size="sm">
            <CSVLink
              data={csvData}
              filename={`sales-invoiced-${report.startDate}-${report.endDate}.csv`}
            >
              <Trans>Export CSV</Trans>
            </CSVLink>
          </Button>
        )}
      </div>

      {revenue ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<LuChartNoAxesCombined />}
              title={<Trans>Net invoiced sales</Trans>}
              value={currency.format(netSales)}
              description={periodLabel}
              to={path.to.invoicingSales}
              linkLabel={t`View Sales Invoices`}
            />
            <MetricCard
              icon={<LuFileText />}
              title={<Trans>Posted invoices</Trans>}
              value={currency.format(invoiceSales)}
              description={<Trans>Excludes tax and freight</Trans>}
              to={path.to.invoicingSales}
              linkLabel={t`View Sales Invoices`}
            />
            <MetricCard
              icon={<LuReceiptText />}
              title={<Trans>Customer credits</Trans>}
              value={currency.format(-credits)}
              description={<Trans>Deducted from invoiced sales</Trans>}
              to={path.to.creditMemos}
              linkLabel={t`View Credit Memos`}
            />
            <MetricCard
              icon={<LuPackageOpen />}
              title={<Trans>Open order backlog</Trans>}
              value={currency.format(report.backlog.amount)}
              description={t`${formatCount(report.backlog.count)} orders as of ${formatDate(report.asOfDate)} · merchandise only`}
              to={path.to.salesOrders}
              linkLabel={t`View Sales Orders`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Invoiced sales trend</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Invoices less customer credits by posting date. Amounts are in
                  company base currency.
                </Trans>
              </p>
              <ChartContainer
                config={chartConfig}
                aria-label={t`Invoiced sales, credits, and net sales by period`}
                summary={t`Net sales ${currency.format(netSales)} from ${periodLabel}`}
                className="h-[280px] w-full"
              >
                <ComposedChart data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="period"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      compactCurrency.format(value as number)
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => currency.format(Number(value))}
                      />
                    }
                  />
                  <Bar
                    dataKey="invoiceSales"
                    fill="var(--color-invoiceSales)"
                    radius={2}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="credits"
                    fill="var(--color-credits)"
                    radius={2}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="netSales"
                    stroke="var(--color-netSales)"
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
              <p className="text-xs text-muted-foreground">
                <Trans>Invoices · Credits · Net sales</Trans>
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  <Trans>Top customers by net sales</Trans>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {revenue.customers.length ? (
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>
                          <Trans>Customer</Trans>
                        </Th>
                        <Th>
                          <Trans>Invoices</Trans>
                        </Th>
                        <Th>
                          <Trans>Credits</Trans>
                        </Th>
                        <Th>
                          <Trans>Net sales</Trans>
                        </Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {revenue.customers.map((customer) => (
                        <Tr key={customer.customerId}>
                          <Td>
                            <Hyperlink
                              to={`${path.to.invoicingSales}?filter=customerId:eq:${encodeURIComponent(customer.customerId)}`}
                            >
                              {customer.customerName}
                            </Hyperlink>
                          </Td>
                          <Td>{currency.format(customer.invoiceSales)}</Td>
                          <Td>{currency.format(-customer.credits)}</Td>
                          <Td>
                            {currency.format(
                              customer.invoiceSales - customer.credits
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                ) : (
                  <Empty />
                )}
              </CardContent>
            </Card>
            {backlogOrders}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MetricCard
            icon={<LuPackageOpen />}
            title={<Trans>Open order backlog</Trans>}
            value={currency.format(report.backlog.amount)}
            description={t`${formatCount(report.backlog.count)} orders as of ${formatDate(report.asOfDate)} · merchandise only`}
            to={path.to.salesOrders}
            linkLabel={t`View Sales Orders`}
          />
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Invoice analytics</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <Trans>
                Invoicing view permission is required to see invoice sales and
                customer credits.
              </Trans>
            </CardContent>
          </Card>
          {backlogOrders}
        </div>
      )}
    </div>
  );
}
