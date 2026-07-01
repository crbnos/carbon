import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
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
  VStack
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import {
  getLocalTimeZone,
  now,
  parseDate,
  toCalendarDateTime
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { DateRange } from "@react-types/datepicker";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  LuArrowUpRight,
  LuChevronDown,
  LuClock,
  LuCreditCard,
  LuEllipsisVertical,
  LuFile,
  LuInbox,
  LuLayoutList,
  LuPackageSearch
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Await, Link, useFetcher, useLoaderData } from "react-router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { DateSelect, Empty, Hyperlink, SupplierAvatar } from "~/components";
import { CSVLink } from "~/components/CSVLink";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import type { PurchaseInvoice } from "~/modules/invoicing";
import { PurchaseInvoicingStatus } from "~/modules/invoicing";
import type { PurchaseOrder, SupplierQuote } from "~/modules/purchasing";
import { getPurchasingDocumentsAssignedToMe } from "~/modules/purchasing";
import { KPIs } from "~/modules/purchasing/purchasing.models";
import { PurchasingStatus } from "~/modules/purchasing/ui/PurchaseOrder";
import { SupplierStatusIndicator } from "~/modules/purchasing/ui/Supplier/SupplierStatusIndicator";
import { SupplierQuoteStatus } from "~/modules/purchasing/ui/SupplierQuote";
import {
  type ApprovalRequest,
  getPendingApprovalsForApprover
} from "~/modules/shared";

import type { loader as kpiLoader } from "~/routes/api+/purchasing.kpi.$key";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";

const OPEN_SUPPLIER_QUOTE_STATUSES = ["Active"] as const;
const OPEN_INVOICE_STATUSES = [
  "Draft",
  "Return",
  "Pending",
  "Partially Paid"
] as const;
const OPEN_PURCHASE_ORDER_STATUSES = [
  "Draft",
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "Needs Approval",
  "Planned",
  "To Invoice"
] as const;

const chartConfig = {
  value: {
    color: "hsl(var(--primary))"
  }
} satisfies ChartConfig;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const serviceRole = getCarbonServiceRole();

  // Get pending approval requests to find which POs the user can approve
  const pendingApprovals = await getPendingApprovalsForApprover(
    serviceRole,
    userId,
    companyId
  );

  // Extract purchase order IDs that need approval and user can approve
  const approvalPoIds =
    pendingApprovals.data
      ?.filter(
        (approval: ApprovalRequest) =>
          approval.documentType === "purchaseOrder" && approval.documentId
      )
      .map((approval: ApprovalRequest) => approval.documentId!)
      .filter((id): id is string => !!id) ?? [];

  // Extract supplier IDs that need approval and user can approve
  const approvalSupplierIds =
    pendingApprovals.data
      ?.filter(
        (approval: ApprovalRequest) =>
          approval.documentType === "supplier" && approval.documentId
      )
      .map((approval: ApprovalRequest) => approval.documentId!)
      .filter((id): id is string => !!id) ?? [];

  const [
    openPurchaseOrders,
    openPurchaseInvoices,
    openSupplierQuotes,
    purchaseOrdersNeedingApproval,
    suppliersNeedingApproval
  ] = await Promise.all([
    client
      .from("purchaseOrder")
      .select("id, purchaseOrderId, status, supplierId, assignee, createdAt", {
        count: "exact"
      })
      .in("status", OPEN_PURCHASE_ORDER_STATUSES)
      .eq("companyId", companyId)
      .limit(10),
    client
      .from("purchaseInvoice")
      .select("id, invoiceId, status, supplierId, assignee, createdAt", {
        count: "exact"
      })
      .in("status", OPEN_INVOICE_STATUSES)
      .eq("companyId", companyId)
      .limit(10),
    client
      .from("supplierQuote")
      .select("id, supplierQuoteId, status, supplierId, assignee, createdAt", {
        count: "exact"
      })
      .in("status", OPEN_SUPPLIER_QUOTE_STATUSES)
      .eq("companyId", companyId)
      .limit(10),
    approvalPoIds.length > 0
      ? client
          .from("purchaseOrder")
          .select(
            "id, purchaseOrderId, status, supplierId, assignee, createdAt"
          )
          .eq("status", "Needs Approval")
          .eq("companyId", companyId)
          .in("id", approvalPoIds)
      : { data: [], error: null },
    approvalSupplierIds.length > 0
      ? client
          .from("supplier")
          .select("id, name, supplierStatus")
          .eq("supplierStatus", "Pending")
          .eq("companyId", companyId)
          .in("id", approvalSupplierIds)
      : { data: [], error: null }
  ]);

  const assignedToMePromise = getPurchasingDocumentsAssignedToMe(
    client,
    userId,
    companyId
  );

  return {
    openPurchaseOrders: openPurchaseOrders,
    openSupplierQuotes: openSupplierQuotes,
    openPurchaseInvoices: openPurchaseInvoices,
    purchaseOrdersNeedingApproval: purchaseOrdersNeedingApproval,
    suppliersNeedingApproval: suppliersNeedingApproval,
    assignedToMe: assignedToMePromise
  };
}

export default function PurchaseDashboard() {
  const {
    openPurchaseOrders,
    openSupplierQuotes,
    openPurchaseInvoices,
    purchaseOrdersNeedingApproval,
    suppliersNeedingApproval,
    assignedToMe
  } = useLoaderData<typeof loader>();

  const mergedOpenDocs = useMemo(() => {
    const merged = [
      ...(openPurchaseOrders.data?.map((doc) => ({
        ...doc,
        type: "purchaseOrder"
      })) ?? []),
      ...(openSupplierQuotes.data?.map((doc) => ({
        ...doc,
        type: "supplierQuote"
      })) ?? []),
      ...(openPurchaseInvoices.data?.map((doc) => ({
        ...doc,
        type: "purchaseInvoice"
      })) ?? []),
      ...(purchaseOrdersNeedingApproval.data?.map((doc) => ({
        ...doc,
        type: "purchaseOrder"
      })) ?? [])
    ]
      .filter(
        (doc, index, self) =>
          index ===
          self.findIndex((d) => d.id === doc.id && d.type === doc.type)
      )
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

    return merged;
  }, [
    openPurchaseOrders,
    openSupplierQuotes,
    openPurchaseInvoices,
    purchaseOrdersNeedingApproval
  ]);

  const { t } = useLingui();
  const kpiFetcher = useFetcher<typeof kpiLoader>();
  const isFetching = kpiFetcher.state !== "idle" || !kpiFetcher.data;

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric"
  });

  const { company } = useUser();

  const currencyCompactFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode,
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short"
  });
  const currencyFormatter = useCurrencyFormatter();
  const numberFormatter = useNumberFormatter({
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short"
  });

  const [supplierId, setSupplierId] = useState<string>("all");
  const [suppliers] = useSuppliers();
  const supplierOptions = useMemo(() => {
    return [
      { label: t`All Suppliers`, value: "all" },
      ...suppliers.map((supplier) => ({
        label: supplier.name,
        value: supplier.id
      }))
    ];
  }, [suppliers, t]);

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState("purchaseOrderAmount");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = toCalendarDateTime(now("UTC"));
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const selectedKpiData = KPIs.find((k) => k.key === selectedKpi) || KPIs[0];

  const kpiLabels: Record<string, string> = useMemo(
    () => ({
      supplierQuoteCount: t`Supplier Quotes`,
      purchaseOrderCount: t`Purchase Orders`,
      purchaseInvoiceCount: t`Purchase Invoices`,
      purchaseOrderAmount: t`Purchase Order Amount`,
      purchaseInvoiceAmount: t`Purchase Invoice Amount`
    }),
    [t]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    kpiFetcher.load(
      `${path.to.api.purchasingKpi(
        selectedKpiData.key
      )}?start=${dateRange?.start.toString()}&end=${dateRange?.end.toString()}&interval=${interval}${
        supplierId === "all" ? "" : `&supplierId=${supplierId}`
      }`
    );
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

  const totalData = useMemo(() => {
    if (!kpiFetcher.data?.data) return null;
    return {
      value: kpiFetcher.data.data.reduce((acc, curr) => acc + curr.value, 0)
    };
  }, [kpiFetcher.data?.data]);

  const previousTotalData = useMemo(() => {
    if (!kpiFetcher.data?.previousPeriodData) return null;
    return {
      value: kpiFetcher.data.previousPeriodData.reduce(
        (acc, curr) => acc + curr.value,
        0
      )
    };
  }, [kpiFetcher.data?.previousPeriodData]);

  const total = totalData?.value ?? 0;
  const previousTotal = previousTotalData?.value ?? 0;

  const percentageChange =
    previousTotal === 0
      ? total > 0
        ? 100
        : 0
      : ((total - previousTotal) / previousTotal) * 100;

  const formatValue = (value: number) => {
    if (
      ["purchaseOrderAmount", "purchaseInvoiceAmount"].includes(
        selectedKpiData.key
      )
    ) {
      return currencyFormatter.format(value);
    }
    return numberFormatter.format(value);
  };

  const csvData = useMemo(() => {
    if (!kpiFetcher.data?.data) return [];
    return [
      ["Date", "Value"],
      ...kpiFetcher.data.data.map((item) => [
        "date" in item ? item.date : item.monthKey,
        item.value
      ])
    ];
  }, [kpiFetcher.data?.data]);

  const csvFilename = useMemo(() => {
    const startDate = dateRange?.start.toString();
    const endDate = dateRange?.end.toString();
    return `${kpiLabels[selectedKpiData.key]}_${startDate}_to_${endDate}.csv`;
  }, [dateRange, kpiLabels, selectedKpiData.key]);

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row gap-2">
            <LuPackageSearch className="text-muted-foreground" />
            <CardTitle>
              <Trans>Active Supplier Quotes</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {openSupplierQuotes.count ?? 0}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${
                    path.to.supplierQuotes
                  }?filter=status:in:${OPEN_SUPPLIER_QUOTE_STATUSES.join(",")}`}
                >
                  <Trans>View Active Quotes</Trans>
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuLayoutList className="text-muted-foreground" />
            <CardTitle>
              <Trans>Open Purchase Orders</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {openPurchaseOrders.count ?? 0}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${
                    path.to.purchaseOrders
                  }?filter=status:in:${OPEN_PURCHASE_ORDER_STATUSES.join(",")}`}
                >
                  <Trans>View Open POs</Trans>
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuCreditCard className="text-muted-foreground" />
            <CardTitle>
              <Trans>Open Purchase Invoices</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {openPurchaseInvoices.count ?? 0}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${
                    path.to.invoicingPurchasing
                  }?filter=status:in:${OPEN_INVOICE_STATUSES.join(",")}`}
                >
                  <Trans>View Open Invoices</Trans>
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>
      </div>

      <Card>
        <HStack className="justify-between items-center">
          <CardHeader>
            <div className="flex w-full justify-start items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                    className="hover:bg-background/80"
                  >
                    <span>{kpiLabels[selectedKpiData.key]}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="start">
                  <DropdownMenuRadioGroup
                    value={selectedKpi}
                    onValueChange={setSelectedKpi}
                  >
                    {KPIs.map((kpi) => (
                      <DropdownMenuRadioItem key={kpi.key} value={kpi.key}>
                        {kpiLabels[kpi.key]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <Combobox
                asButton
                value={supplierId}
                onChange={setSupplierId}
                options={supplierOptions}
                size="sm"
                className="font-medium text-sm min-w-[160px] gap-4"
              />
            </div>
          </CardHeader>
          <CardAction className="flex-row items-center gap-2">
            <DateSelect
              value={interval}
              onValueChange={onIntervalChange}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="secondary"
                  icon={<LuEllipsisVertical />}
                  aria-label={t`More`}
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
                    <Trans>Export CSV</Trans>
                  </CSVLink>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </HStack>
        <CardContent className="flex-col gap-4">
          <VStack className="pl-[3px]" spacing={0}>
            {isFetching ? (
              <div className="flex flex-col gap-0.5 w-full">
                <Skeleton className="h-8 w-[120px]" />
                <Skeleton className="h-4 w-[50px]" />
              </div>
            ) : (
              <>
                <p className="text-3xl font-medium tracking-tighter">
                  {formatValue(total)}
                </p>
                {percentageChange >= 0 ? (
                  <Badge variant="green">+{percentageChange.toFixed(0)}%</Badge>
                ) : (
                  <Badge variant="red">{percentageChange.toFixed(0)}%</Badge>
                )}
              </>
            )}
          </VStack>
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
                      "purchaseInvoiceAmount"
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
                          "purchaseInvoiceAmount"
                        ].includes(selectedKpiData.key)
                          ? currencyFormatter.format(value as number)
                          : numberFormatter.format(value as number)
                      }
                    />
                  }
                />
                <Bar dataKey="value" fill="var(--color-value)" radius={2} />
              </BarChart>
            </ChartContainer>
          </Loading>
        </CardContent>
      </Card>
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row gap-2">
            <LuClock className="text-muted-foreground" />
            <CardTitle>
              <Trans>Recently Created</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="min-h-[200px] max-h-[360px] w-full overflow-y-auto">
              {mergedOpenDocs.length > 0 ? (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>
                        <Trans>Document</Trans>
                      </Th>
                      <Th>
                        <Trans>Status</Trans>
                      </Th>
                      <Th>
                        <Trans>Supplier</Trans>
                      </Th>
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
          <CardHeader className="flex-row gap-2">
            <LuInbox className="text-muted-foreground" />
            <CardTitle>
              <Trans>Assigned to Me</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-[200px]">
            <Suspense fallback={<Loading isLoading />}>
              <Await
                resolve={assignedToMe}
                errorElement={
                  <div>
                    <Trans>Error loading assigned documents</Trans>
                  </div>
                }
              >
                {(assignedDocs) => (
                  <AssignedDocumentsTable
                    assignedDocs={assignedDocs}
                    purchaseOrdersNeedingApproval={
                      purchaseOrdersNeedingApproval.data ?? []
                    }
                    suppliersNeedingApproval={
                      suppliersNeedingApproval.data ?? []
                    }
                  />
                )}
              </Await>
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type AssignedDocument = {
  id: string;
  type: "purchaseOrder" | "supplierQuote" | "purchaseInvoice" | "supplier";
  [key: string]: unknown;
};

function AssignedDocumentsTable({
  assignedDocs,
  purchaseOrdersNeedingApproval,
  suppliersNeedingApproval
}: {
  assignedDocs: Array<{ id: string; type: string; [key: string]: unknown }>;
  purchaseOrdersNeedingApproval: Array<{
    id: string;
    purchaseOrderId: string;
    status: string;
    supplierId: string | null;
    assignee: string | null;
    createdAt: string | null;
  }>;
  suppliersNeedingApproval: Array<{
    id: string;
    name: string;
    supplierStatus: string | null;
  }>;
}) {
  // Merge assigned docs with purchase orders needing approval
  // Deduplicate: if a PO is both assigned and needs approval, prefer the assigned version
  const assignedPurchaseOrderIds = new Set(
    assignedDocs
      .filter((doc) => doc.type === "purchaseOrder")
      .map((doc) => doc.id)
  );

  const approvalDocs = purchaseOrdersNeedingApproval
    .filter((po) => !assignedPurchaseOrderIds.has(po.id))
    .map((doc) => ({
      ...doc,
      type: "purchaseOrder" as const
    }));

  const supplierDocs = suppliersNeedingApproval.map((doc) => ({
    ...doc,
    type: "supplier" as const
  }));

  const allDocs = [
    ...assignedDocs,
    ...approvalDocs,
    ...supplierDocs
  ] as AssignedDocument[];

  if (allDocs.length === 0) {
    return (
      <div className="flex justify-center items-center h-full">
        <Empty />
      </div>
    );
  }

  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Document</Trans>
          </Th>
          <Th>
            <Trans>Status</Trans>
          </Th>
          <Th>
            <Trans>Supplier</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {allDocs.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} />
        ))}
      </Tbody>
    </Table>
  );
}

function DocumentRow({ doc }: { doc: AssignedDocument }) {
  switch (doc.type) {
    case "purchaseOrder":
      return <PurchaseOrderDocumentRow doc={doc as unknown as PurchaseOrder} />;
    case "supplierQuote":
      return <SupplierQuoteRow doc={doc as unknown as SupplierQuote} />;
    case "purchaseInvoice":
      return <PurchaseInvoiceRow doc={doc as unknown as PurchaseInvoice} />;
    case "supplier":
      return (
        <SupplierApprovalRow
          doc={
            doc as unknown as {
              id: string;
              name: string;
              supplierStatus: string | null;
            }
          }
        />
      );
    default:
      return null;
  }
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
        {/* @ts-expect-error - Return type is not defined */}
        <PurchaseInvoicingStatus status={doc.status} />
      </Td>
      <Td>
        <SupplierAvatar supplierId={doc.supplierId} />
      </Td>
    </Tr>
  );
}

function SupplierApprovalRow({
  doc
}: {
  doc: { id: string; name: string; supplierStatus: string | null };
}) {
  return (
    <Tr>
      <Td>
        <Hyperlink to={path.to.supplier(doc.id)}>
          <SupplierAvatar supplierId={doc.id} />
        </Hyperlink>
      </Td>
      <Td>
        <SupplierStatusIndicator status={doc.supplierStatus as "Pending"} />
      </Td>
      <Td>-</Td>
    </Tr>
  );
}
