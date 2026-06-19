import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { companyHasPlan } from "@carbon/ee/plan.server";
import { Avatar } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLocale, useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuBookMarked, LuImage, LuShield, LuShieldCheck } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  Breadcrumbs,
  MethodIcon,
  Table
} from "~/components";
import { getJobOperationAttachments } from "~/modules/production";
import { salesOrderStatusType } from "~/modules/sales/sales.models";
import { getExternalSalesOrderLines } from "~/modules/sales/sales.service";
import {
  JobOperationProgress,
  jobOperationValidator,
  PortalLineStatus,
  PortalSort,
  type SortableColumn
} from "~/modules/sales/ui/CustomerPortal";
import { SalesStatus } from "~/modules/sales/ui/SalesOrder";
import { getCompany } from "~/modules/settings/settings.service";
import {
  getBase64ImageFromSupabase,
  getCustomerPortal
} from "~/modules/shared/shared.service";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const meta = () => {
  return [{ title: "Customer Portal" }];
};

const defaultColumnPinning = {
  left: ["customerReference"]
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    throw new Error("Customer ID is required");
  }

  const serviceRole = getCarbonServiceRole();
  const customer = await getCustomerPortal(serviceRole, id);

  if (customer.error) {
    console.error(customer.error);
    throw new Error("Customer not found");
  }

  if (!customer.data.customerId) {
    console.error(customer.error);
    throw new Error("Customer not found");
  }

  const hasPlan = await companyHasPlan(serviceRole, customer.data.companyId, {
    feature: "CUSTOMER_PORTALS"
  });
  if (!hasPlan) {
    throw new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [company, salesOrderLines] = await Promise.all([
    getCompany(serviceRole, customer.data.companyId),
    getExternalSalesOrderLines(serviceRole, customer.data.customerId, {
      search,
      limit,
      offset,
      sorts,
      filters
    })
  ]);

  if (salesOrderLines.error) {
    console.error(salesOrderLines.error);
    throw new Error("Sales order lines not found");
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

  const [thumbnails, jobOperationAttachments] = await Promise.all([
    (thumbnailPaths
      ? await Promise.all(
          Object.entries(thumbnailPaths).map(([id, path]) => {
            if (!path) {
              return null;
            }
            return getBase64ImageFromSupabase(serviceRole, path).then(
              (data) => ({
                id,
                data
              })
            );
          })
        )
      : []
    )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
      if (thumbnail) {
        acc[thumbnail.id] = thumbnail.data;
      }
      return acc;
    }, {}) ?? {},
    getJobOperationAttachments(serviceRole, jobOperationIds ?? [])
  ]);

  return {
    customer: customer.data,
    company: company.data,
    salesOrderLines: salesOrderLines.data ?? [],
    jobOperationAttachments,
    count: salesOrderLines.count,
    thumbnails
  };
}

export default function CustomerPortal() {
  const {
    count,
    customer,
    company,
    salesOrderLines,
    thumbnails,
    jobOperationAttachments
  } = useLoaderData<typeof loader>();

  const { locale } = useLocale();
  const formatter = useNumberFormatter({
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

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
          filter: {
            type: "static",
            options: salesOrderStatusType.map((status) => ({
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
        cell: ({ row }) => formatDate(row.original.orderDate, undefined, locale)
      },
      {
        accessorKey: "promisedDate",
        header: "Due Date",
        cell: ({ row }) =>
          formatDate(
            row.original.promisedDate ??
              row.original.receiptPromisedDate ??
              row.original.receiptRequestedDate,
            undefined,
            locale
          )
      },
      {
        accessorKey: "readableId",
        header: "Part Number",
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
            <div className="flex items-center gap-1.5">
              <MethodIcon type="Pull from Inventory" />
              <span>{formatter.format(row.original.saleQuantity ?? 0)}</span>
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
      }
    ];
  }, [formatter, thumbnails, jobOperationAttachments, locale, customer.id]);

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
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
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
      <div className="flex flex-1 overflow-hidden">
        <Table<(typeof salesOrderLines)[number]>
          data={salesOrderLines}
          columns={columns}
          count={count ?? 0}
          compact
          defaultColumnPinning={defaultColumnPinning}
          sort={<PortalSort columns={sortableColumns} />}
        />
      </div>
    </div>
  );
}
