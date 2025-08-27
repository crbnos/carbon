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
import {
  getLocalTimeZone,
  now,
  parseDate,
  toCalendarDateTime,
} from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { DateRange } from "@react-types/datepicker";
import { Await, Link, useFetcher, useLoaderData } from "@remix-run/react";
import { defer, type LoaderFunctionArgs } from "@vercel/remix";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CSVLink } from "react-csv";
import {
  LuArrowUpRight,
  LuChevronDown,
  LuCreditCard,
  LuEllipsisVertical,
  LuFile,
  LuLayoutList,
  LuPackageSearch,
} from "react-icons/lu";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Empty, Hyperlink, SupplierAvatar } from "~/components";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import type { PurchaseInvoice } from "~/modules/invoicing";
import { PurchaseInvoicingStatus } from "~/modules/invoicing";
import type { PurchaseOrder, SupplierQuote } from "~/modules/purchasing";
import { getPurchasingDocumentsAssignedToMe } from "~/modules/purchasing";
import { KPIs } from "~/modules/purchasing/purchasing.models";
import { PurchasingStatus } from "~/modules/purchasing/ui/PurchaseOrder";
import { SupplierQuoteStatus } from "~/modules/purchasing/ui/SupplierQuote";
import { chartIntervals } from "~/modules/shared/shared.models";
import type { loader as kpiLoader } from "~/routes/api+/purchasing.kpi.$key";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";

const OPEN_SUPPLIER_QUOTE_STATUSES = ["Active"] as const;
const OPEN_INVOICE_STATUSES = [
  "Draft",
  "Return",
  "Pending",
  "Partially Paid",
] as const;
const OPEN_PURCHASE_ORDER_STATUSES = [
  "Draft",
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
] as const;

const chartConfig = {} satisfies ChartConfig;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const [openPurchaseOrders, openPurchaseInvoices, openSupplierQuotes] =
    await Promise.all([
      client
        .from("purchaseOrder")
        .select(
          "id, purchaseOrderId, status, supplierId, assignee, createdAt",
          {
            count: "exact",
          }
        )
        .in("status", OPEN_PURCHASE_ORDER_STATUSES)
        .eq("companyId", companyId)
        .limit(10),
      client
        .from("purchaseInvoice")
        .select("id, invoiceId, status, supplierId, assignee, createdAt", {
          count: "exact",
        })
        .in("status", OPEN_INVOICE_STATUSES)
        .eq("companyId", companyId)
        .limit(10),
      client
        .from("supplierQuote")
        .select(
          "id, supplierQuoteId, status, supplierId, assignee, createdAt",
          {
            count: "exact",
          }
        )
        .in("status", OPEN_SUPPLIER_QUOTE_STATUSES)
        .eq("companyId", companyId)
        .limit(10),
    ]);

  return defer({
    openPurchaseOrders: openPurchaseOrders,
    openSupplierQuotes: openSupplierQuotes,
    openPurchaseInvoices: openPurchaseInvoices,
    assignedToMe: getPurchasingDocumentsAssignedToMe(client, userId, companyId),
  });
}

export default function PurchaseDashboard() {
  const {
    openPurchaseOrders,
    openSupplierQuotes,
    openPurchaseInvoices,
    assignedToMe,
  } = useLoaderData<typeof loader>();

  const mergedOpenDocs = useMemo(() => {
    const merged = [
      ...(openPurchaseOrders.data?.map((doc) => ({
        ...doc,
        type: "purchaseOrder",
      })) ?? []),
      ...(openSupplierQuotes.data?.map((doc) => ({
        ...doc,
        type: "supplierQuote",
      })) ?? []),
      ...(openPurchaseInvoices.data?.map((doc) => ({
        ...doc,
        type: "purchaseInvoice",
      })) ?? []),
    ].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

    return merged;
  }, [openPurchaseOrders, openSupplierQuotes, openPurchaseInvoices]);

  const kpiFetcher = useFetcher<typeof kpiLoader>();
  const isFetching = kpiFetcher.state !== "idle" || !kpiFetcher.data;

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric",
  });

  const { company } = useUser();

  const currencyCompactFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode,
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short",
  });
  const currencyFormatter = useCurrencyFormatter();
  const numberFormatter = useNumberFormatter({
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short",
  });

  const [supplierId, setSupplierId] = useState<string>("all");
  const [suppliers] = useSuppliers();
  const supplierOptions = useMemo(() => {
    return [
      { label: "All Suppliers", value: "all" },
      ...suppliers.map((supplier) => ({
        label: supplier.name,
        value: supplier.id,
      })),
    ];
  }, [suppliers]);

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState("purchaseOrderAmount");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = toCalendarDateTime(now("UTC"));
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const selectedInterval =
    chartIntervals.find((i) => i.key === interval) || chartIntervals[1];
  const selectedKpiData = KPIs.find((k) => k.key === selectedKpi) || KPIs[0];

  useEffect(() => {
    kpiFetcher.load(
      `${path.to.api.purchasingKpi(
        selectedKpiData.key
      )}?start=${dateRange?.start.toString()}&end=${dateRange?.end.toString()}&interval=${interval}${
        supplierId === "all" ? "" : `&supplierId=${supplierId}`
      }`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKpi, dateRange, interval, selectedKpiData.key, supplierId]);

  const onIntervalChange = (value: string) => {
    const end = toCalendarDateTime(now("UTC"));
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

  const total =
    kpiFetcher.data?.data.reduce((acc, curr) => acc + curr.value, 0) ?? 0;
  const previousTotal =
    kpiFetcher.data?.previousPeriodData.reduce(
      (acc, curr) => acc + curr.value,
      0
    ) ?? 0;
  const percentageChange =
    previousTotal === 0
      ? total > 0
        ? 100
        : 0
      : ((total - previousTotal) / previousTotal) * 100;

  const csvData = useMemo(() => {
    if (!kpiFetcher.data?.data) return [];
    return [
      ["Date", "Value"],
      ...kpiFetcher.data.data.map((item) => [
        "date" in item ? item.date : item.monthKey,
        item.value,
      ]),
    ];
  }, [kpiFetcher.data?.data]);

  const csvFilename = useMemo(() => {
    const startDate = dateRange?.start.toString();
    const endDate = dateRange?.end.toString();
    return `${selectedKpiData.label}_${startDate}_to_${endDate}.csv`;
  }, [dateRange, selectedKpiData.label]);

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="p-6 rounded-xl items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <LuPackageSearch className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.supplierQuotes
                }?filter=status:in:${OPEN_SUPPLIER_QUOTE_STATUSES.join(",")}`}
              >
                View Quotes
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openSupplierQuotes.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Active Supplier Quotes
            </p>
          </div>
        </Card>

        <Card className="p-6 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <LuLayoutList className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
            >
              <Link
                to={`${
                  path.to.purchaseOrders
                }?filter=status:in:${OPEN_PURCHASE_ORDER_STATUSES.join(",")}`}
              >
                View Purchase Orders
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openPurchaseOrders.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Purchase Orders
            </p>
          </div>
        </Card>

        <Card className="p-6 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <LuCreditCard className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.purchaseInvoices
                }?filter=status:in:${OPEN_INVOICE_STATUSES.join(",")}`}
              >
                View Invoices
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openPurchaseInvoices.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Purchase Invoices
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
                value={supplierId}
                onChange={setSupplierId}
                options={supplierOptions}
                size="sm"
                className="font-medium text-sm min-w-[160px] gap-4"
              />
            </div>
            <HStack className="pl-[3px] pt-1">
              {isFetching ? (
                <Skeleton className="h-8 w-1/2" />
              ) : (
                <>
                  <p className="text-xl font-semibold tracking-tight">
                    {["purchaseOrderAmount", "purchaseInvoiceAmount"].includes(
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
                    return [
                      "purchaseOrderAmount",
                      "purchaseInvoiceAmount",
                    ].includes(selectedKpiData.key)
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
                        [
                          "purchaseOrderAmount",
                          "purchaseInvoiceAmount",
                        ].includes(selectedKpiData.key)
                          ? currencyFormatter.format(value as number)
                          : numberFormatter.format(value as number)
                      }
                    />
                  }
                />
                <Bar dataKey="value" className="fill-violet-600" radius={2} />
              </BarChart>
            </ChartContainer>
          </Loading>
        </CardContent>
      </Card>
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="px-6 pb-0">
            <CardTitle>Recently Created</CardTitle>
            <CardDescription className="text-sm">
              Recently created purchasing documents
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
                        case "purchaseOrder":
                          return (
                            <PurchaseOrderDocumentRow
                              key={doc.id}
                              doc={doc as unknown as PurchaseOrder}
                            />
                          );
                        case "supplierQuote":
                          return (
                            <SupplierQuoteRow
                              key={doc.id}
                              doc={doc as unknown as SupplierQuote}
                            />
                          );
                        case "purchaseInvoice":
                          return (
                            <PurchaseInvoiceRow
                              key={doc.id}
                              doc={doc as unknown as PurchaseInvoice}
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
                            case "purchaseOrder":
                              return (
                                <PurchaseOrderDocumentRow
                                  key={doc.id}
                                  doc={doc as unknown as PurchaseOrder}
                                />
                              );
                            case "supplierQuote":
                              return (
                                <SupplierQuoteRow
                                  key={doc.id}
                                  doc={doc as unknown as SupplierQuote}
                                />
                              );
                            case "purchaseInvoice":
                              return (
                                <PurchaseInvoiceRow
                                  key={doc.id}
                                  doc={doc as unknown as PurchaseInvoice}
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

function SupplierQuoteRow({ doc }: { doc: SupplierQuote }) {
  return (
    <Tr>
      <Td>
        <Hyperlink to={path.to.supplierQuote(doc.id!)}>
          <HStack spacing={1}>
            <LuPackageSearch className="size-4" />
            <span>{doc.supplierQuoteId}</span>
          </HStack>
        </Hyperlink>
      </Td>
      <Td>
        <SupplierQuoteStatus status={doc.status} />
      </Td>
      <Td>
        <SupplierAvatar supplierId={doc.supplierId} />
      </Td>
    </Tr>
  );
}

function PurchaseOrderDocumentRow({ doc }: { doc: PurchaseOrder }) {
  return (
    <Tr>
      <Td>
        <Hyperlink to={path.to.purchaseOrder(doc.id!)}>
          <HStack spacing={1}>
            <LuLayoutList className="size-4" />
            <span>{doc.purchaseOrderId}</span>
          </HStack>
        </Hyperlink>
      </Td>
      <Td>
        <PurchasingStatus status={doc.status} />
      </Td>
      <Td>
        <SupplierAvatar supplierId={doc.supplierId} />
      </Td>
    </Tr>
  );
}

function PurchaseInvoiceRow({ doc }: { doc: PurchaseInvoice }) {
  return (
    <Tr>
      <Td>
        <Hyperlink to={path.to.salesRfq(doc.id!)}>
          <HStack spacing={1}>
            <LuCreditCard className="size-4" />
            <span>{doc.invoiceId}</span>
          </HStack>
        </Hyperlink>
      </Td>
      <Td>
        <PurchaseInvoicingStatus status={doc.status} />
      </Td>
      <Td>
        <SupplierAvatar supplierId={doc.supplierId} />
      </Td>
    </Tr>
  );
}
