import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import {
  Avatar,
  cn,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Separator,
  Status,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
import { useLoaderData, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer } from "@vercel/remix";
import { useMemo } from "react";
import {
  LuBookMarked,
  LuImage,
  LuPaperclip,
  LuShield,
  LuShieldCheck,
} from "react-icons/lu";
import z from "zod";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  Breadcrumbs,
  MethodIcon,
  Table,
} from "~/components";
import {
  getJobOperationAttachments,
  jobOperationStatus,
} from "~/modules/production";
import { JobStatus } from "~/modules/production/ui/Jobs";
import { getExternalSalesOrderLines } from "~/modules/sales/sales.service";
import { SalesStatus } from "~/modules/sales/ui/SalesOrder";
import { getCompany } from "~/modules/settings/settings.service";
import { operationTypes } from "~/modules/shared";
import {
  getBase64ImageFromSupabase,
  getCustomerPortal,
} from "~/modules/shared/shared.service";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const meta = () => {
  return [{ title: "Customer Portal" }];
};

const jobOperationValidator = z
  .object({
    id: z.string(),
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
                data,
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
    getJobOperationAttachments(serviceRole, jobOperationIds ?? []),
  ]);

  return defer({
    customer: customer.data,
    company: company.data,
    salesOrderLines: salesOrderLines.data ?? [],
    jobOperationAttachments,
    count: salesOrderLines.count,
    thumbnails,
  });
}

export default function CustomerPortal() {
  const {
    count,
    customer,
    company,
    salesOrderLines,
    thumbnails,
    jobOperationAttachments,
  } = useLoaderData<typeof loader>();

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
            {thumbnails[row.original.readableIdWithRevision!] ? (
              <img
                alt={row.original.readableIdWithRevision!}
                className="size-8 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                src={
                  thumbnails[row.original.readableIdWithRevision!] ?? undefined
                }
              />
            ) : (
              <div className="size-8 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-1">
                <LuImage className="size-6 text-muted-foreground" />
              </div>
            )}
            {row.original.customerReference ? (
              <>
                <LuShieldCheck className="text-emerald-500 flex-shrink-0" />
                <span>{row.original.customerReference}</span>
              </>
            ) : (
              <>
                <LuShield className="flex-shrink-0" />
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
              salesOrderStatus={row.original.salesOrderStatus}
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

          return (
            <JobOperationProgress
              quantityShipped={row.original.quantitySent ?? 0}
              quantityComplete={row.original.jobQuantityComplete ?? 0}
              jobOperations={jobOperations.data}
              jobOperationAttachments={jobOperationAttachments}
            />
          );
        },
      },
    ];
  }, [formatter, thumbnails, jobOperationAttachments]);

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
  salesOrderStatus,
}: {
  quantityOrdered: number;
  quantityShipped: number;
  jobStatus: Database["public"]["Enums"]["jobStatus"];
  jobOperations: z.infer<typeof jobOperationValidator>;
  salesOrderStatus: Database["public"]["Enums"]["salesOrderStatus"];
}) {
  if (
    ["Draft", "Needs Approval", "Completed", "Cancelled", "Invoiced"].includes(
      salesOrderStatus
    )
  ) {
    return <SalesStatus status={salesOrderStatus} />;
  }

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
  quantityShipped,
  quantityComplete,
  jobOperations,
  jobOperationAttachments,
}: {
  quantityShipped: number;
  quantityComplete: number;
  jobOperations: z.infer<typeof jobOperationValidator>;
  jobOperationAttachments: Record<string, string[]>;
}) {
  const { id } = useParams();
  if (!id) {
    throw new Error("Customer ID is required");
  }

  const isComplete = quantityShipped > 0 || quantityComplete > 0;
  return (
    <div className="flex items-center gap-0">
      {jobOperations
        .sort((a, b) => a.order - b.order)
        .map((operation, index) => {
          const isFirst = index === 0;
          const isLast = index === jobOperations.length - 1;
          const operationId = operation.id;
          const attachments = jobOperationAttachments[operationId];

          return (
            <div
              key={index}
              className={cn(
                `
              flex items-center gap-1 max-w-[140px]
              uppercase font-bold text-[11px] truncate tracking-tight whitespace-nowrap
              px-2 py-1
              border border-border
              transition-colors`,
                operation.status === "Done" || isComplete
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-400"
                  : operation.status === "In Progress"
                  ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300"
                  : "",
                isFirst ? "rounded-l-full" : "-ml-px",
                isLast ? "rounded-r-full" : ""
              )}
            >
              {operation.description}
              {Array.isArray(attachments) && attachments.length > 0 && (
                <HoverCard openDelay={0}>
                  <HoverCardTrigger>
                    <LuPaperclip className="size-3 text-muted-foreground" />
                  </HoverCardTrigger>
                  <HoverCardContent
                    align="end"
                    className="flex flex-col items-end gap-1 text-xs overflow-hidden max-w-96"
                  >
                    <div className="w-full text-left text-xs font-normal tracking-normal flex items-center gap-1">
                      <LuPaperclip className="size-3 text-muted-foreground" />
                      <span>Attachments</span>
                    </div>
                    <Separator className="my-1" />
                    {attachments.map((attachment) => {
                      const fileName = attachment.split("/").pop();
                      return (
                        <div key={attachment}>
                          <a
                            href={path.to.externalCustomerFile(id, attachment)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {fileName}
                          </a>
                        </div>
                      );
                    })}
                  </HoverCardContent>
                </HoverCard>
              )}
            </div>
          );
        })}
    </div>
  );
}
