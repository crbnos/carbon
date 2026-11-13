// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { Avatar, Button } from "@carbon/react";
import { async, SCALE_FORMAT } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { LuBookMarked, LuImage, LuShield, LuShieldCheck } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  Breadcrumbs,
  DateTime,
  MethodIcon,
  Table
} from "~/components";
import { getJobOperationAttachments } from "~/modules/production/production.service";
import { salesOrderStatusType } from "~/modules/sales/sales.models";
import {
  type CustomerPortalSection,
  getActiveCustomerPortal,
  getCustomerPortalOverview,
  getExternalSalesOrderLines
} from "~/modules/sales/sales.service";
import {
  CUSTOMER_PORTAL_HIDDEN_ORDER_STATUSES,
  customerPortalServesFile
} from "~/modules/sales/sales.utils";
import {
  JobOperationProgress,
  jobOperationValidator,
  PortalLineStatus,
  PortalSort,
  type SortableColumn
} from "~/modules/sales/ui/CustomerPortal";
import {
  CustomerPortalOrderDocuments,
  type CustomerPortalOverview,
  CustomerPortalPendingOrders,
  CustomerPortalRecords
} from "~/modules/sales/ui/CustomerPortal/CustomerPortalRecords";
import { CustomerPortalSubmissionForms } from "~/modules/sales/ui/CustomerPortal/CustomerPortalSubmissionForms";
import { SalesStatus } from "~/modules/sales/ui/SalesOrder";
import { getCompany } from "~/modules/settings/settings.service";
import { getBase64ImageFromSupabase } from "~/modules/shared/shared.service";
import { SINGLE_LOAD_LIMIT } from "~/utils/pagination";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const meta = () => {
  return [{ title: "Customer Portal" }];
};

const defaultColumnPinning = {
  left: ["customerReference"]
};

const logger = getLogger("erp", "share", "customer-portal");

// The thumbnails the page downloads at once.
const THUMBNAIL_CONCURRENCY = 8;

type PortalQuoteOption = CustomerPortalOverview["quoteOptions"][number];

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    throw new Error("Customer ID is required");
  }

  const serviceRole = getCarbonServiceRole();
  const customer = await getActiveCustomerPortal(serviceRole, id);

  if (customer.refusal === "error") {
    throw new Error("Failed to load customer portal");
  }
  if (customer.refusal) {
    throw new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { sorts, filters } = getGenericQueryFilters(searchParams);
  const requestedSection = searchParams.get("section");
  const section: CustomerPortalSection =
    requestedSection === "quotes" ||
    requestedSection === "invoices" ||
    requestedSection === "shipments"
      ? requestedSection
      : "orders";

  const [company, salesOrderLines] = await Promise.all([
    getCompany(serviceRole, customer.data.companyId),
    section === "orders"
      ? getExternalSalesOrderLines(serviceRole, customer.data.customerId, {
          search,
          // A single-load list: the RPC returns no row id for a cursor to follow.
          limit: SINGLE_LOAD_LIMIT,
          offset: 0,
          sorts,
          filters,
          hiddenStatuses: CUSTOMER_PORTAL_HIDDEN_ORDER_STATUSES
        })
      : Promise.resolve({ data: [], count: 0, error: null })
  ]);

  if (salesOrderLines.error) {
    logger.error("Sales order lines not found", {
      error: salesOrderLines.error
    });
    throw new Error("Sales order lines not found");
  }
  const overview = await getCustomerPortalOverview(
    serviceRole,
    {
      companyId: customer.data.companyId,
      customerId: customer.data.customerId
    },
    {
      section,
      after: searchParams.get("after"),
      afterRequests: searchParams.get("afterRequests"),
      orderSalesOrderIds: (salesOrderLines.data ?? [])
        .map((line) => line.salesOrderId)
        .filter((id): id is string => !!id)
    }
  );
  if (overview.error || !overview.data) {
    logger.error("Customer portal overview not found", {
      error: overview.error
    });
    throw new Error("Customer portal overview not found");
  }

  const jobOperationIds = jobOperationValidator
    .safeParse(salesOrderLines.data?.flatMap((line) => line.jobOperations))
    .data?.map((operation) => operation.id);

  const thumbnailPaths = salesOrderLines.data?.reduce<
    Record<string, string | null>
  >((acc, line) => {
    if (line.thumbnailPath) {
      acc[line.readableIdWithRevision] = line.thumbnailPath;
    }
    return acc;
  }, {});

  // Up to 1,000 lines: the thumbnails download a few at a time.
  const [thumbnailList, jobOperationAttachments] =
    section === "orders"
      ? await Promise.all([
          async.map(
            Object.entries(thumbnailPaths ?? {}),
            async ([id, path]) =>
              path
                ? {
                    id,
                    data: await getBase64ImageFromSupabase(serviceRole, path)
                  }
                : null,
            { concurrency: THUMBNAIL_CONCURRENCY }
          ),
          getJobOperationAttachments(serviceRole, jobOperationIds ?? [])
        ])
      : [[], {}];
  const thumbnails = thumbnailList.reduce<Record<string, string | null>>(
    (acc, thumbnail) => {
      if (thumbnail) {
        acc[thumbnail.id] = thumbnail.data;
      }
      return acc;
    },
    {}
  );

  // Link only the files the portal serves on job steps.
  const servedAttachments = Object.fromEntries(
    Object.entries(jobOperationAttachments).map(([operationId, paths]) => [
      operationId,
      paths.filter(customerPortalServesFile)
    ])
  );

  return {
    customer: customer.data,
    company: company.data,
    portalOverview: overview.data,
    section,
    after: searchParams.get("after"),
    afterRequests: searchParams.get("afterRequests"),
    salesOrderLines: salesOrderLines.data ?? [],
    isTruncated: (salesOrderLines.data?.length ?? 0) >= SINGLE_LOAD_LIMIT,
    jobOperationAttachments: servedAttachments,
    count: salesOrderLines.count,
    thumbnails
  };
}

export default function CustomerPortal() {
  const {
    count,
    customer,
    company,
    portalOverview,
    section,
    after,
    afterRequests,
    salesOrderLines,
    isTruncated,
    thumbnails,
    jobOperationAttachments
  } = useLoaderData<typeof loader>();

  const formatter = useNumberFormatter(SCALE_FORMAT);
  const location = useLocation();
  const [openForm, setOpenForm] = useState<
    { type: "rfq" } | { type: "po"; quoteOption?: PortalQuoteOption } | null
  >(null);

  function openRequest(form: "rfq" | "po", quoteId?: string) {
    if (form === "rfq") return setOpenForm({ type: "rfq" });
    const quote = portalOverview.quotes.find((item) => item.id === quoteId);
    setOpenForm({
      type: "po",
      quoteOption: quote
        ? { id: quote.id, quoteId: quote.quoteId, status: quote.status }
        : undefined
    });
  }

  const quoteOptions: PortalQuoteOption[] = [
    ...portalOverview.quoteOptions,
    ...portalOverview.quotes.filter(
      (quote) =>
        quote.status === "Sent" &&
        !portalOverview.quoteOptions.some((choice) => choice.id === quote.id)
    )
  ];
  if (
    openForm?.type === "po" &&
    openForm.quoteOption &&
    !quoteOptions.some((choice) => choice.id === openForm.quoteOption?.id)
  ) {
    quoteOptions.push(openForm.quoteOption);
  }

  function pageUrl(next: string | null, nextRequests = afterRequests) {
    const query = new URLSearchParams(location.search);
    query.set("section", section);
    if (next) query.set("after", next);
    else query.delete("after");
    if (nextRequests) query.set("afterRequests", nextRequests);
    else query.delete("afterRequests");
    return `?${query.toString()}`;
  }

  const columns = useMemo<ColumnDef<(typeof salesOrderLines)[number]>[]>(() => {
    return [
      {
        accessorKey: "customerReference",
        header: "PO/SO #",
        size: 180,
        cell: ({ row }) => (
          <div className="flex items-center gap-1 min-w-0">
            {thumbnails[row.original.readableIdWithRevision!] ? (
              <img
                alt={row.original.readableIdWithRevision!}
                className="size-8 bg-gradient-to-bl from-muted to-muted/40 rounded-lg flex-shrink-0"
                src={
                  thumbnails[row.original.readableIdWithRevision!] ?? undefined
                }
              />
            ) : (
              <div className="size-8 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-1 flex-shrink-0">
                <LuImage className="size-6 text-muted-foreground" />
              </div>
            )}
            {row.original.customerReference ? (
              <>
                <LuShieldCheck className="text-emerald-500 flex-shrink-0" />
                <span className="text-xs font-medium truncate">
                  {row.original.customerReference}
                </span>
              </>
            ) : (
              <>
                <LuShield className="flex-shrink-0" />
                <span className="text-xs font-medium truncate">
                  {row.original.salesOrderId}
                </span>
              </>
            )}
          </div>
        ),
        meta: {
          mobile: "P1",
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "salesOrderStatus",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => {
          const jobOperations = jobOperationValidator.safeParse(
            row.original.jobOperations
          );
          return (
            <PortalLineStatus
              quantityOrdered={row.original.saleQuantity}
              quantityShipped={row.original.quantitySent}
              jobStatus={row.original.jobStatus}
              jobOperations={jobOperations.data ?? []}
              salesOrderStatus={row.original.salesOrderStatus}
            />
          );
        },
        meta: {
          mobile: "P2",
          filter: {
            type: "static",
            options: salesOrderStatusType
              .filter(
                (status) =>
                  !(
                    CUSTOMER_PORTAL_HIDDEN_ORDER_STATUSES as readonly string[]
                  ).includes(status)
              )
              .map((status) => ({
                value: status,
                label: <SalesStatus status={status} disableTooltip />
              }))
          },
          pluralHeader: "Statuses"
        }
      },
      {
        accessorKey: "customerContactName",
        header: "Buyer",
        cell: ({ row }) =>
          row.original.customerContactName ? (
            <div className="flex items-center gap-2">
              <Avatar name={row.original.customerContactName} size="xs" />
              <span>{row.original.customerContactName}</span>
            </div>
          ) : null
      },
      {
        accessorKey: "customerEngineeringContactName",
        header: "Engineer",
        cell: ({ row }) =>
          row.original.customerEngineeringContactName ? (
            <div className="flex items-center gap-2">
              <Avatar
                name={row.original.customerEngineeringContactName}
                size="xs"
              />
              <span>{row.original.customerEngineeringContactName}</span>
            </div>
          ) : null
      },
      {
        accessorKey: "orderDate",
        header: "Order Date",
        cell: ({ row }) => (
          <DateTime value={row.original.orderDate} variant="date" />
        )
      },
      {
        accessorKey: "promisedDate",
        header: "Due Date",
        meta: { mobile: "P2" },
        cell: ({ row }) => (
          <DateTime
            // The promised date only: the requested date is often the order
            // date, which made every line read as overdue.
            value={
              row.original.promisedDate ?? row.original.receiptPromisedDate
            }
            variant="date"
          />
        )
      },
      {
        accessorKey: "readableId",
        header: "Part Number",
        meta: { mobile: "P3" },
        cell: ({ row }) => row.original.readableId
      },
      {
        accessorKey: "revision",
        header: "Rev.",
        cell: ({ row }) => row.original.revision
      },
      {
        id: "quantity",
        header: "Complete",
        cell: ({ row }) =>
          row.original?.jobProductionQuantity ? (
            <div className="flex items-center gap-1.5">
              <MethodIcon type="Make to Order" />
              <span>
                {`${formatter.format(
                  row.original.jobQuantityComplete
                )}/${formatter.format(row.original.jobProductionQuantity)}`}
              </span>
            </div>
          ) : (
            // No job builds this line, so there is nothing to report as
            // complete; Shipped shows its progress.
            <div className="flex items-center gap-1.5">
              <MethodIcon type="Pull from Inventory" />
              <span className="text-muted-foreground">-</span>
            </div>
          )
      },
      {
        id: "shipped",
        header: "Shipped",
        cell: ({ row }) =>
          row.original?.jobProductionQuantity
            ? `${formatter.format(
                row.original.jobQuantityShipped
              )}/${formatter.format(row.original.jobProductionQuantity)}`
            : `${formatter.format(
                row.original.quantitySent ?? 0
              )}/${formatter.format(row.original.saleQuantity ?? 0)}`
      },
      {
        id: "jobOperations",
        header: "Progress",
        cell: ({ row }) => {
          const jobOperations = jobOperationValidator.safeParse(
            row.original.jobOperations
          );

          if (!jobOperations.success) {
            return null;
          }

          if (!row.original.jobProductionQuantity) {
            return null;
          }

          return (
            <JobOperationProgress
              customerId={customer.id}
              jobOperations={jobOperations.data}
              jobOperationAttachments={jobOperationAttachments}
            />
          );
        }
      },
      {
        id: "customerUpdate",
        header: "Update",
        cell: ({ row }) =>
          row.original.portalLateReason || row.original.portalDeliveryUpdate ? (
            <div className="max-w-72 space-y-1 text-sm">
              {row.original.portalLateReason && (
                <p className="text-amber-700 dark:text-amber-300">
                  {row.original.portalLateReason}
                </p>
              )}
              {row.original.portalDeliveryUpdate && (
                <p>{row.original.portalDeliveryUpdate}</p>
              )}
            </div>
          ) : null
      },
      {
        id: "documents",
        header: "Documents",
        cell: ({ row }) => {
          const order = portalOverview.orders.find(
            (entry) => entry.salesOrderId === row.original.salesOrderId
          );
          return order ? (
            <CustomerPortalOrderDocuments
              portalId={customer.id}
              overview={portalOverview}
              orderId={order.id}
            />
          ) : null;
        }
      }
    ];
  }, [
    formatter,
    thumbnails,
    jobOperationAttachments,
    customer.id,
    portalOverview
  ]);

  const sortableColumns = useMemo<SortableColumn[]>(
    () =>
      columns.flatMap((c) =>
        "accessorKey" in c &&
        typeof c.accessorKey === "string" &&
        typeof c.header === "string" &&
        c.enableSorting !== false
          ? [{ value: c.accessorKey, label: c.header }]
          : []
      ),
    [columns]
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <div className="flex justify-between items-center py-3 px-4 bg-background border-b w-full">
        <Breadcrumbs>
          <BreadcrumbItem>
            <BreadcrumbLink to="#">{company?.name}</BreadcrumbLink>
          </BreadcrumbItem>
          {customer?.customerId && (
            <BreadcrumbItem>
              <BreadcrumbLink to={path.to.externalCustomer(customer.id)}>
                {customer?.customer?.name}
              </BreadcrumbLink>
            </BreadcrumbItem>
          )}
        </Breadcrumbs>
      </div>
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">
              {customer?.customer?.name ?? "Customer portal"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Track your orders and download issued documents.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => openRequest("rfq")}
            >
              Request a quote
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => openRequest("po")}
            >
              Send a PO
            </Button>
          </div>
        </div>
        {openForm && (
          <CustomerPortalSubmissionForms
            key={`${openForm.type}:${openForm.type === "po" ? (openForm.quoteOption?.id ?? "") : ""}`}
            portalId={customer.id}
            quotes={quoteOptions}
            initialForm={openForm.type}
            initialQuoteId={
              openForm.type === "po" ? openForm.quoteOption?.id : undefined
            }
            onClose={() => setOpenForm(null)}
          />
        )}
        <nav
          className="flex gap-2 overflow-x-auto border-b pb-2"
          aria-label="Portal sections"
        >
          {(
            [
              ["orders", "Orders"],
              ["quotes", "Quotes"],
              ["invoices", "Invoices"],
              ["shipments", "Packing slips"]
            ] as const
          ).map(([key, label]) => {
            const loaded =
              key === "orders"
                ? salesOrderLines.length + portalOverview.pendingPos.length
                : key === "quotes"
                  ? portalOverview.quotes.length + portalOverview.rfqs.length
                  : portalOverview[key].length;
            const total = section === key ? `${loaded} shown` : null;
            return (
              <Button
                key={key}
                variant={section === key ? "active" : "ghost"}
                aria-current={section === key ? "page" : undefined}
                asChild
              >
                <Link to={`?section=${key}`}>
                  {label}
                  {total && (
                    <span className="ml-1 text-xs opacity-70">{total}</span>
                  )}
                </Link>
              </Button>
            );
          })}
        </nav>
        {section === "orders" ? (
          <div className="flex min-h-[560px] flex-col gap-4">
            <CustomerPortalPendingOrders
              pendingPos={portalOverview.pendingPos}
            />
            {(after || portalOverview.nextCursor.orders) && (
              <div className="flex gap-2">
                {after && (
                  <Button variant="secondary" asChild>
                    <Link to={pageUrl(null)}>
                      Newest pending purchase orders
                    </Link>
                  </Button>
                )}
                {portalOverview.nextCursor.orders && (
                  <Button variant="secondary" asChild>
                    <Link to={pageUrl(portalOverview.nextCursor.orders)}>
                      Older pending purchase orders
                    </Link>
                  </Button>
                )}
              </div>
            )}
            <div className="flex min-h-[480px] flex-1 overflow-hidden rounded-lg border">
              <Table<(typeof salesOrderLines)[number]>
                data={salesOrderLines}
                columns={columns}
                count={count ?? 0}
                isTruncated={isTruncated}
                compact
                // Signed out: the export names ids from the signed-in company's
                // lists, and there is no company here to read them from.
                withCsvExport={false}
                defaultColumnPinning={defaultColumnPinning}
                sort={<PortalSort columns={sortableColumns} />}
              />
            </div>
          </div>
        ) : (
          <CustomerPortalRecords
            portalId={customer.id}
            overview={portalOverview}
            section={section}
            after={after}
            afterRequests={afterRequests}
            search={location.search}
            onOrderQuote={(quoteId) => openRequest("po", quoteId)}
          />
        )}
      </main>
    </div>
  );
}
