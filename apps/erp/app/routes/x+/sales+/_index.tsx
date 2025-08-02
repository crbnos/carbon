import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Combobox,
  DateRangePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Loading,
  Skeleton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@carbon/react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@carbon/react/Chart";
import { FunnelChart } from "@carbon/react/FunnelChart";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { DateRange } from "@react-types/datepicker";
import { Await, Link, useFetcher, useLoaderData } from "@remix-run/react";
import { defer, type LoaderFunctionArgs } from "@vercel/remix";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CSVLink } from "react-csv";
import {
  LuArrowUpRight,
  LuChevronDown,
  LuEllipsisVertical,
  LuFile,
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { CustomerAvatar, Empty, Hyperlink } from "~/components";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { KPIs } from "~/modules/sales/sales.models";
import { getSalesDocumentsAssignedToMe } from "~/modules/sales/sales.service";
import type { Quotation, SalesOrder, SalesRFQ } from "~/modules/sales/types";
import QuoteStatus from "~/modules/sales/ui/Quotes/QuoteStatus";
import { SalesStatus } from "~/modules/sales/ui/SalesOrder";
import { SalesRFQStatus } from "~/modules/sales/ui/SalesRFQ";
import { chartIntervals } from "~/modules/shared/shared.models";
import type { loader as kpiLoader } from "~/routes/api+/sales.kpi.$key";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";

const OPEN_RFQ_STATUSES = ["Ready for Quote", "Draft"] as const;
const OPEN_QUOTE_STATUSES = ["Sent", "Draft"] as const;
const OPEN_SALES_ORDER_STATUSES = [
  "Confirmed",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Needs Approval",
  "In Progress",
  "Draft",
] as const;

const chartConfig = {} satisfies ChartConfig;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const [openSalesOrders, openQuotes, openRFQs] = await Promise.all([
    client
      .from("salesOrder")
      .select("id, salesOrderId, status, customerId, assignee, createdAt", {
        count: "exact",
      })
      .in("status", OPEN_SALES_ORDER_STATUSES)
      .eq("companyId", companyId),
    client
      .from("quote")
      .select("id, quoteId, status, customerId, assignee, createdAt", {
        count: "exact",
      })
      .in("status", OPEN_QUOTE_STATUSES)
      .eq("companyId", companyId),
    client
      .from("salesRfq")
      .select("id, rfqId, status, customerId, assignee, createdAt", {
        count: "exact",
      })
      .in("status", OPEN_RFQ_STATUSES)
      .eq("companyId", companyId),
  ]);

  return defer({
    openSalesOrders: openSalesOrders,
    openQuotes: openQuotes,
    openRFQs: openRFQs,
    assignedToMe: getSalesDocumentsAssignedToMe(client, userId, companyId),
  });
}

export default function SalesDashboard() {
  const { openSalesOrders, openQuotes, openRFQs, assignedToMe } =
    useLoaderData<typeof loader>();

  const mergedOpenDocs = useMemo(() => {
    const merged = [
      ...(openSalesOrders.data?.map((doc) => ({
        ...doc,
        type: "salesOrder",
      })) ?? []),
      ...(openQuotes.data?.map((doc) => ({ ...doc, type: "quote" })) ?? []),
      ...(openRFQs.data?.map((doc) => ({ ...doc, type: "rfq" })) ?? []),
    ].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

    return merged;
  }, [openSalesOrders, openQuotes, openRFQs]);

  const kpiFetcher = useFetcher<typeof kpiLoader>();
  const isFetching = kpiFetcher.state !== "idle" || !kpiFetcher.data;

  const steps = useMemo(() => {
    const defaultSteps = [
      {
        id: "rfqs",
        label: "RFQs",
        value: 0,
        colorClassName: "text-violet-600",
      },
      {
        id: "quotes",
        label: "Quotes",
        value: 0,
        colorClassName: "text-blue-600",
      },
      {
        id: "salesOrders",
        label: "Sales Orders",
        value: 0,
        additionalValue: 0,
        colorClassName: "text-teal-500",
      },
    ];

    if (!kpiFetcher.data?.data) {
      return defaultSteps;
    }

    const getKpiValue = (name: string) =>
      kpiFetcher.data?.data?.find(
        (item) => "name" in item && item.name === name
      )?.value ?? 0;

    return [
      {
        ...defaultSteps[0],
        value: getKpiValue("RFQs"),
      },
      {
        ...defaultSteps[1],
        value: getKpiValue("Quotes"),
      },
      {
        ...defaultSteps[2],
        value: getKpiValue("Sales Orders"),
        additionalValue: getKpiValue("Revenue"),
      },
    ];
  }, [kpiFetcher.data?.data]);

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric",
  });

  const currencyCompactFormatter = useCurrencyFormatter({
    notation: "compact",
    compactDisplay: "short",
  });
  const currencyFormatter = useCurrencyFormatter();
  const numberFormatter = useNumberFormatter({
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short",
  });

  const [customerId, setCustomerId] = useState<string>("all");
  const [customers] = useCustomers();
  const customerOptions = useMemo(() => {
    return [
      { label: "All Customers", value: "all" },
      ...customers.map((customer) => ({
        label: customer.name,
        value: customer.id,
      })),
    ];
  }, [customers]);

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState("salesOrderRevenue");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = today("UTC");
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const selectedInterval =
    chartIntervals.find((i) => i.key === interval) || chartIntervals[1];
  const selectedKpiData = KPIs.find((k) => k.key === selectedKpi) || KPIs[0];

  useEffect(() => {
    kpiFetcher.load(
      `${path.to.api.salesKpi(
        selectedKpiData.key
      )}?start=${dateRange?.start.toString()}&end=${dateRange?.end.toString()}&interval=${interval}${
        customerId === "all" ? "" : `&customerId=${customerId}`
      }`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKpi, dateRange, interval, selectedKpiData.key, customerId]);

  const onIntervalChange = (value: string) => {
    const end = today("UTC");
    if (value === "week") {
      const start = end.add({ days: -7 });
      setDateRange({ start, end });
    } else if (value === "month") {
      const start = end.add({ months: -1 });
      setDateRange({ start, end });
    } else if (value === "quarter") {
      const start = end.add({ months: -3 });
      setDateRange({ start, end });
    } else if (value === "year") {
      const start = end.add({ years: -1 });
      setDateRange({ start, end });
    }

    setInterval(value);
  };

  const totalData = useMemo(() => {
    if (!kpiFetcher.data?.data) return null;

    // For salesFunnel, find the Revenue item
    if (selectedKpi === "salesFunnel") {
      return kpiFetcher.data.data.find(
        (item) => "name" in item && item.name === "Revenue"
      );
    }

    // For other KPIs, calculate total
    return {
      value:
        kpiFetcher.data.data.reduce((acc, curr) => acc + curr.value, 0) ?? 0,
    };
  }, [kpiFetcher.data?.data, selectedKpi]);

  const previousTotalData = useMemo(() => {
    if (!kpiFetcher.data?.previousPeriodData) return null;

    // For salesFunnel, find the Revenue item
    if (selectedKpi === "salesFunnel") {
      return kpiFetcher.data.previousPeriodData.find(
        (item) => "name" in item && item.name === "Revenue"
      );
    }

    // For other KPIs, calculate total
    return {
      value:
        kpiFetcher.data.previousPeriodData.reduce(
          (acc, curr) => acc + curr.value,
          0
        ) ?? 0,
    };
  }, [kpiFetcher.data?.previousPeriodData, selectedKpi]);

  const total = totalData?.value ?? 0;
  const previousTotal = previousTotalData?.value ?? 0;

  const percentageChange =
    previousTotal === 0
      ? total > 0
        ? 100
        : 0
      : ((total - previousTotal) / previousTotal) * 100;

  const csvData = useMemo(() => {
    if (!kpiFetcher.data?.data) return [];

    // Handle different data formats based on KPI type
    if (selectedKpi === "salesFunnel") {
      return [
        ["Name", "Value"],
        ...kpiFetcher.data.data.map((item) => [
          "name" in item ? item.name : "",
          item.value,
        ]),
      ];
    }

    return [
      ["Date", "Value"],
      ...kpiFetcher.data.data.map((item) => [
        "date" in item
          ? item.date
          : "month" in item
          ? item.month
          : // @ts-ignore
            item.monthKey,
        item.value,
      ]),
    ];
  }, [kpiFetcher.data?.data, selectedKpi]);

  const csvFilename = useMemo(() => {
    const startDate = dateRange?.start.toString();
    const endDate = dateRange?.end.toString();
    return `${selectedKpiData.label}_${startDate}_to_${endDate}${
      customerId === "all"
        ? ""
        : `_${customers.find((c) => c.id === customerId)?.name}`
    }.csv`;
  }, [
    dateRange?.start,
    dateRange?.end,
    selectedKpiData.label,
    customerId,
    customers,
  ]);

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="p-6 rounded-xl items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <RiProgress2Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.salesRfqs
                }?filter=status:in:${OPEN_RFQ_STATUSES.join(",")}`}
              >
                View RFQs
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openRFQs.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open RFQs
            </p>
          </div>
        </Card>

        <Card className="p-6 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <RiProgress4Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
            >
              <Link
                to={`${
                  path.to.quotes
                }?filter=status:in:${OPEN_QUOTE_STATUSES.join(",")}`}
              >
                View Quotes
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openQuotes.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Quotes
            </p>
          </div>
        </Card>

        <Card className="p-6 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <RiProgress8Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.salesOrders
                }?filter=status:in:${OPEN_SALES_ORDER_STATUSES.join(",")}`}
              >
                View Orders
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openSalesOrders.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Sales Orders
            </p>
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <HStack className="justify-between items-start">
          <CardHeader className="pb-0">
            <div className="flex w-full justify-start items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                    className="hover:bg-background/80"
                  >
                    <span>{selectedKpiData.label}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="start">
                  <DropdownMenuRadioGroup
                    value={selectedKpi}
                    onValueChange={setSelectedKpi}
                  >
                    {KPIs.map((kpi) => (
                      <DropdownMenuRadioItem key={kpi.key} value={kpi.key}>
                        {kpi.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                    className="hover:bg-background/80"
                  >
                    <span>
                      {selectedInterval.key === "custom"
                        ? selectedInterval.label
                        : `Last ${selectedInterval.label}`}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="start">
                  <DropdownMenuRadioGroup
                    value={interval}
                    onValueChange={onIntervalChange}
                  >
                    {chartIntervals.map((i) => (
                      <DropdownMenuRadioItem key={i.key} value={i.key}>
                        {i.key === "custom" ? i.label : `Last ${i.label}`}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {interval === "custom" && (
                <DateRangePicker
                  size="sm"
                  value={dateRange}
                  onChange={setDateRange}
                />
              )}
              <Combobox
                asButton
                value={customerId}
                onChange={setCustomerId}
                options={customerOptions}
                size="sm"
                className="min-w-[160px] gap-4"
              />
            </div>
            <HStack className="pl-[3px] pt-1">
              {isFetching ? (
                <Skeleton className="h-8 w-1/2" />
              ) : (
                <>
                  <p className="text-xl font-semibold tracking-tight">
                    {["salesOrderRevenue", "salesFunnel"].includes(
                      selectedKpiData.key
                    )
                      ? currencyFormatter.format(total)
                      : numberFormatter.format(total)}
                  </p>
                  {percentageChange >= 0 ? (
                    <Badge variant="green">
                      +{percentageChange.toFixed(0)}%
                    </Badge>
                  ) : (
                    <Badge variant="red">{percentageChange.toFixed(0)}%</Badge>
                  )}
                </>
              )}
            </HStack>
          </CardHeader>
          <CardAction className="py-6 px-6">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="secondary"
                  icon={<LuEllipsisVertical />}
                  aria-label="More"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <CSVLink
                    data={csvData}
                    filename={csvFilename}
                    className="flex flex-row items-center gap-2"
                  >
                    <DropdownMenuIcon icon={<LuFile />} />
                    Export CSV
                  </CSVLink>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </HStack>
        <CardContent className="p-6">
          <Loading
            isLoading={isFetching}
            className="h-[30dvw] md:h-[23dvw] w-full"
          >
            {selectedKpi === "salesFunnel" ? (
              <FunnelChart
                steps={steps}
                currencyFormatter={currencyCompactFormatter}
                numberFormatter={numberFormatter}
              />
            ) : (
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[30dvw] md:h-[23dvw] w-full"
              >
                <BarChart accessibilityLayer data={kpiFetcher.data?.data ?? []}>
                  <CartesianGrid vertical={false} />
                  <YAxis
                    dataKey="value"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => {
                      return ["salesOrderRevenue"].includes(selectedKpiData.key)
                        ? currencyCompactFormatter.format(value as number)
                        : numberFormatter.format(value as number);
                    }}
                  />
                  <XAxis
                    dataKey={
                      ["week", "month"].includes(interval) ? "date" : "month"
                    }
                    tickLine={false}
                    tickMargin={8}
                    minTickGap={32}
                    axisLine={false}
                    tickFormatter={(value) => {
                      if (!value) return "";
                      return ["week", "month"].includes(interval)
                        ? dateFormatter.format(
                            parseDate(value).toDate(getLocalTimeZone())
                          )
                        : value.slice(0, 3);
                    }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={
                          ["week", "month"].includes(interval)
                            ? (value) =>
                                dateFormatter.format(
                                  parseDate(value).toDate(getLocalTimeZone())
                                )
                            : (value) => (
                                <span className="font-mono">{value}</span>
                              )
                        }
                        formatter={(value) =>
                          ["salesOrderRevenue"].includes(selectedKpiData.key)
                            ? currencyFormatter.format(value as number)
                            : numberFormatter.format(value as number)
                        }
                      />
                    }
                  />
                  <Bar
                    dataKey="value"
                    className={cn(
                      ["salesOrderRevenue", "salesOrderCount"].includes(
                        selectedKpiData.key
                      ) && "fill-teal-400",
                      ["quoteCount"].includes(selectedKpiData.key) &&
                        "fill-blue-600",
                      ["rfqCount"].includes(selectedKpiData.key) &&
                        "fill-violet-600"
                    )}
                    radius={2}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </Loading>
        </CardContent>
      </Card>
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="px-6 pb-0">
            <CardTitle>Recently Created</CardTitle>
            <CardDescription className="text-sm">
              Newly created sales documents
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="min-h-[200px] max-h-[360px] w-full overflow-y-auto">
              {mergedOpenDocs.length > 0 ? (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Document</Th>
                      <Th>Status</Th>
                      <Th>Customer</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {mergedOpenDocs.map((doc) => {
                      switch (doc.type) {
                        case "salesOrder":
                          return (
                            <SalesOrderDocumentRow
                              key={doc.id}
                              doc={doc as unknown as SalesOrder}
                            />
                          );
                        case "quote":
                          return (
                            <QuoteDocumentRow
                              key={doc.id}
                              doc={doc as unknown as Quotation}
                            />
                          );
                        case "rfq":
                          return (
                            <RfqDocumentRow
                              key={doc.id}
                              doc={doc as unknown as SalesRFQ}
                            />
                          );
                        default:
                          return null;
                      }
                    })}
                  </Tbody>
                </Table>
              ) : (
                <div className="flex justify-center items-center h-full">
                  <Empty />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-6 pb-0">
            <CardTitle>Assigned to Me</CardTitle>
            <CardDescription className="text-sm">
              Sales documents currently assigned to me
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 min-h-[200px]">
            <Suspense fallback={<Loading isLoading />}>
              <Await
                resolve={assignedToMe}
                errorElement={<div>Error loading assigned documents</div>}
              >
                {(assignedDocs) =>
                  assignedDocs.length > 0 ? (
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Document</Th>
                          <Th>Status</Th>
                          <Th>Customer</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {assignedDocs.map((doc) => {
                          switch (doc.type) {
                            case "salesOrder":
                              return (
                                <SalesOrderDocumentRow
                                  key={doc.id}
                                  doc={doc as unknown as SalesOrder}
                                />
                              );
                            case "quote":
                              return (
                                <QuoteDocumentRow
                                  key={doc.id}
                                  doc={doc as unknown as Quotation}
                                />
                              );
                            case "rfq":
                              return (
                                <RfqDocumentRow
                                  key={doc.id}
                                  doc={doc as unknown as SalesRFQ}
                                />
                              );
                            default:
                              return null;
                          }
                        })}
                      </Tbody>
                    </Table>
                  ) : (
                    <div className="flex justify-center items-center h-full">
                      <Empty />
                    </div>
                  )
                }
              </Await>
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SalesOrderDocumentRow({ doc }: { doc: SalesOrder }) {
  return (
    <Tr>
      <Td>
        <Hyperlink to={path.to.salesOrder(doc.id!)}>
          <HStack spacing={1}>
            <RiProgress8Line className="size-4" />
            <span>{doc.salesOrderId}</span>
          </HStack>
        </Hyperlink>
      </Td>
      <Td>
        <SalesStatus status={doc.status} />
      </Td>
      <Td>
        <CustomerAvatar customerId={doc.customerId} />
      </Td>
    </Tr>
  );
}

function QuoteDocumentRow({ doc }: { doc: Quotation }) {
  return (
    <Tr>
      <Td>
        <Hyperlink to={path.to.quote(doc.id!)}>
          <HStack spacing={1}>
            <RiProgress4Line className="size-4" />
            <span>{doc.quoteId}</span>
          </HStack>
        </Hyperlink>
      </Td>
      <Td>
        <QuoteStatus status={doc.status} />
      </Td>
      <Td>
        <CustomerAvatar customerId={doc.customerId} />
      </Td>
    </Tr>
  );
}

function RfqDocumentRow({ doc }: { doc: SalesRFQ }) {
  return (
    <Tr>
      <Td>
        <Hyperlink to={path.to.salesRfq(doc.id!)}>
          <HStack spacing={1}>
            <RiProgress2Line className="size-4" />
            <span>{doc.rfqId}</span>
          </HStack>
        </Hyperlink>
      </Td>
      <Td>
        <SalesRFQStatus status={doc.status} />
      </Td>
      <Td>
        <CustomerAvatar customerId={doc.customerId} />
      </Td>
    </Tr>
  );
}
