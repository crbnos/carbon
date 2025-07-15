import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { Avatar, cn, Status } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
import { useLoaderData } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { useMemo } from "react";
import { LuBookMarked, LuShield, LuShieldCheck } from "react-icons/lu";
import z from "zod";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  Breadcrumbs,
  MethodIcon,
  Table,
} from "~/components";
import { jobOperationStatus } from "~/modules/production";
import { JobStatus } from "~/modules/production/ui/Jobs";
import { getExternalSalesOrderLines } from "~/modules/sales/sales.service";
import { getCompany } from "~/modules/settings/settings.service";
import { operationTypes } from "~/modules/shared";
import { getCustomerPortal } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const meta = () => {
  return [{ title: "Customer Portal" }];
};

const jobOperationValidator = z
  .object({
    status: z.enum(jobOperationStatus),
    description: z.string(),
    order: z.number(),
    operationType: z.enum(operationTypes),
    operationQuantity: z.number(),
    quantityComplete: z.number(),
  })
  .array();

const defaultColumnPinning = {
  left: ["customerReference"],
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
      filters,
    }),
  ]);

  if (salesOrderLines.error) {
    console.error(salesOrderLines.error);
    throw new Error("Sales order lines not found");
  }

  return json({
    customer: customer.data,
    company: company.data,
    salesOrderLines: salesOrderLines.data ?? [],
    count: salesOrderLines.count,
  });
}

export default function CustomerPortal() {
  const { count, customer, company, salesOrderLines } =
    useLoaderData<typeof loader>();

  const formatter = useNumberFormatter({
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const columns = useMemo<ColumnDef<(typeof salesOrderLines)[number]>[]>(() => {
    return [
      {
        accessorKey: "customerReference",
        header: "PO/SO #",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.original.customerReference ? (
              <>
                <LuShieldCheck className="text-emerald-500" />
                <span>{row.original.customerReference}</span>
              </>
            ) : (
              <>
                <LuShield />
                <span>{row.original.salesOrderId}</span>
              </>
            )}
          </div>
        ),
        meta: {
          icon: <LuBookMarked />,
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const jobOperations = jobOperationValidator.safeParse(
            row.original.jobOperations
          );
          return (
            <SalesOrderLineStatus
              quantityOrdered={row.original.saleQuantity}
              quantityShipped={row.original.quantitySent}
              jobStatus={row.original.jobStatus}
              jobOperations={jobOperations.data ?? []}
            />
          );
        },
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
          ) : null,
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
          ) : null,
      },
      {
        accessorKey: "orderDate",
        header: "Order Date",
        cell: ({ row }) => formatDate(row.original.orderDate),
      },
      {
        accessorKey: "promisedDate",
        header: "Due Date",
        cell: ({ row }) =>
          formatDate(
            row.original.promisedDate ??
              row.original.receiptPromisedDate ??
              row.original.receiptRequestedDate
          ),
      },
      {
        accessorKey: "readableId",
        header: "Part Number",
        cell: ({ row }) => row.original.readableId,
      },
      {
        accessorKey: "revision",
        header: "Rev.",
        cell: ({ row }) => row.original.revision,
      },
      {
        id: "quantity",
        header: "Complete",
        cell: ({ row }) =>
          row.original?.jobProductionQuantity ? (
            <div className="flex items-center gap-1.5">
              <MethodIcon type="Make" />
              <span>
                {`${formatter.format(
                  row.original.jobQuantityComplete
                )}/${formatter.format(row.original.jobProductionQuantity)}`}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <MethodIcon type="Pick" />
              <span>{formatter.format(row.original.saleQuantity ?? 0)}</span>
            </div>
          ),
      },
      {
        id: "shipped",
        header: "Shipped",
        cell: ({ row }) =>
          row.original?.jobQuantityShipped
            ? `${formatter.format(
                row.original.jobQuantityShipped
              )}/${formatter.format(row.original.jobProductionQuantity)}`
            : `${formatter.format(
                row.original.quantitySent ?? 0
              )}/${formatter.format(row.original.saleQuantity ?? 0)}`,
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

          return <JobOperationProgress jobOperations={jobOperations.data} />;
        },
      },
    ];
  }, [formatter]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
      <div className="flex justify-between items-center py-3 px-4 bg-background border-b w-ful">
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
        />
      </div>
    </div>
  );
}

function SalesOrderLineStatus({
  quantityOrdered,
  quantityShipped,
  jobStatus,
  jobOperations,
}: {
  quantityOrdered: number;
  quantityShipped: number;
  jobStatus: Database["public"]["Enums"]["jobStatus"];
  jobOperations: z.infer<typeof jobOperationValidator>;
}) {
  if (quantityOrdered === quantityShipped) {
    return <Status color="blue">Shipped</Status>;
  }

  if (quantityShipped > 0) {
    return <Status color="orange">Partially Shipped</Status>;
  }

  if (!jobStatus || ["Draft", "Ready", "Planned"].includes(jobStatus)) {
    return <Status color="yellow">Planned</Status>;
  }

  if (
    ["In Progress", "Paused"].includes(jobStatus) ||
    jobOperations?.some((operation) =>
      ["In Progress", "Done"].includes(operation.status)
    )
  ) {
    return <Status color="green">In Progress</Status>;
  }

  return <JobStatus status={jobStatus} />;
}

function JobOperationProgress({
  jobOperations,
}: {
  jobOperations: z.infer<typeof jobOperationValidator>;
}) {
  return (
    <div className="flex items-center gap-0">
      {jobOperations
        .sort((a, b) => a.order - b.order)
        .map((operation, index) => {
          const isFirst = index === 0;
          const isLast = index === jobOperations.length - 1;

          return (
            <div
              key={index}
              className={cn(
                `
              max-w-[140px]
              uppercase font-bold text-[11px] truncate tracking-tight whitespace-nowrap
              px-2 py-1
              border border-border
              transition-colors`,
                operation.status === "Done"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-400"
                  : operation.status === "In Progress"
                  ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300"
                  : "",
                isFirst ? "rounded-l-full" : "-ml-px",
                isLast ? "rounded-r-full" : ""
              )}
            >
              {operation.description}
            </div>
          );
        })}
    </div>
  );
}
