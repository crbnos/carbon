import { useCarbon } from "@carbon/auth";
import {
  Badge,
  BarProgress,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  HStack,
  MenuIcon,
  MenuItem,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import {
  getLocalTimeZone,
  isSameDay,
  parseDate,
  today
} from "@internationalized/date";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuBookMarked,
  LuCalendar,
  LuClock,
  LuHash,
  LuMapPin,
  LuPencil,
  LuQrCode,
  LuSquareUser,
  LuTag,
  LuTrash,
  LuUser,
  LuUsers
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { action } from "~/routes/x+/job+/update";
import { useCustomers, useParts, usePeople, useTools } from "~/stores";
import { path } from "~/utils/path";
import { deadlineTypes, jobStatus } from "../../production.models";
import type { Job } from "../../types";
import { getDeadlineIcon } from "./Deadline";
import JobStatus from "./JobStatus";

type JobsTableProps = {
  data: Job[];
  count: number;
  tags: { name: string }[];
};

const defaultColumnVisibility = {
  description: false,
  createdAt: false,
  createdBy: false,
  updatedAt: false,
  updatedBy: false,
  orderQuantity: false,
  inventoryQuantity: false,
  productionQuantity: false,
  scrapQuantity: false,
  quantityComplete: false,
  quantityShipped: false,
  quantityReceivedToInventory: false
};

function useReadableTrackedEntities(data: Job[], companyId: string) {
  const [trackedEntities, setTrackedEntities] = useState<
    Record<string, string>
  >({});
  const { carbon } = useCarbon();

  async function getTrackedEntities(
    jobMakeMethodIds: string[],
    companyId: string
  ) {
    if (carbon) {
      const response = await carbon
        ?.from("trackedEntity")
        .select("*")
        .in("attributes->>Job Make Method", jobMakeMethodIds)
        .eq("companyId", companyId);

      if (response.data) {
        const result = response.data.reduce<Record<string, string>>(
          (acc, curr) => {
            if (
              curr.attributes !== null &&
              typeof curr.attributes === "object" &&
              "Job Make Method" in curr.attributes &&
              curr.readableId
            ) {
              acc[curr.attributes["Job Make Method"] as string] =
                curr.readableId;
            }
            return acc;
          },
          {}
        );

        setTrackedEntities(result);
      }
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    getTrackedEntities(
      data.reduce<string[]>((acc, curr) => {
        if (curr.jobMakeMethodId) {
          acc.push(curr.jobMakeMethodId);
        }
        return acc;
      }, []),
      companyId
    );
  }, [data]);

  return trackedEntities;
}

const JobsTable = memo(({ data, count, tags }: JobsTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const parts = useParts();
  const tools = useTools();
  const {
    company: { id: companyId }
  } = useUser();

  const items = useMemo(() => [...parts, ...tools], [parts, tools]);

  const [people] = usePeople();
  const [customers] = useCustomers();
  const locations = useLocations();

  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const trackedEntities = useReadableTrackedEntities(data, companyId);

  const onDelete = (data: Job) => {
    setSelectedJob(data);
    deleteModal.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedJob(null);
    deleteModal.onClose();
  };

  const todaysDate = useMemo(() => today(getLocalTimeZone()), []);

  const customColumns = useCustomColumns<Job>("job");
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const columns = useMemo<ColumnDef<Job>[]>(() => {
    const defaultColumns: ColumnDef<Job>[] = [
      {
        accessorKey: "jobId",
        header: "Job ID",
        cell: ({ row }) => (
          <HStack>
            <ItemThumbnail
              size="md"
              thumbnailPath={row.original.thumbnailPath}
              // @ts-ignore
              type={row.original.itemType}
            />
            <Hyperlink to={path.to.job(row.original.id!)}>
              {row.original?.jobId}
            </Hyperlink>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "itemReadableIdWithRevision",
        header: "Item",
        cell: ({ row }) => {
          return (
            <VStack spacing={0}>
              {row.original.itemReadableIdWithRevision}
              <div className="w-full truncate text-muted-foreground text-xs">
                {row.original.name}
              </div>
            </VStack>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: items?.map((item) => ({
              value: item.readableIdWithRevision,
              label: item.readableIdWithRevision
            }))
          },
          icon: <AiOutlinePartition />
        }
      },
      {
        id: "trackedEntityId",
        header: "Tracking",
        cell: ({ row }) =>
          row.original.jobMakeMethodId &&
          trackedEntities[row.original.jobMakeMethodId] ? (
            <Badge variant="secondary" className="items-center gap-1">
              <LuQrCode />
              {trackedEntities[row.original.jobMakeMethodId]}
            </Badge>
          ) : null,
        meta: {
          icon: <LuQrCode />
        }
      },
      {
        accessorKey: "quantity",
        header: "Quantity",
        cell: ({ row }) => {
          if (row.original.status === "Ready") {
            return (
              <BarProgress
                progress={
                  ((row.original.quantityComplete ?? 0) /
                    (row.original.quantity ?? 0)) *
                  100
                }
              />
            );
          }
          return row.original.quantity;
        },
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },

      {
        id: "customerId",
        header: "Customer",
        cell: ({ row }) => (
          <CustomerAvatar customerId={row.original.customerId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name
            }))
          },
          icon: <LuSquareUser />
        }
      },
      {
        accessorKey: "salesOrderReadableId",
        header: "Sales Order",
        cell: ({ row }) =>
          row.original.salesOrderId && row.original.salesOrderLineId ? (
            <Hyperlink
              to={path.to.salesOrderLine(
                row.original.salesOrderId,
                row.original.salesOrderLineId!
              )}
            >
              {row.original?.salesOrderReadableId}
            </Hyperlink>
          ) : null,
        meta: {
          icon: <LuBookMarked />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.salesOrders,
            transform: (data: { id: string; salesOrderId: string }[] | null) =>
              data?.map(({ salesOrderId }) => ({
                value: salesOrderId,
                label: salesOrderId
              })) ?? []
          }
        }
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.original.status;
          const dueDate = row.original.dueDate;
          return (
            <HStack spacing={1}>
              <JobStatus status={status} />
              {["Draft", "Planned", "In Progress", "Ready", "Paused"].includes(
                status ?? ""
              ) && (
                <>
                  {dueDate && isSameDay(parseDate(dueDate), todaysDate) && (
                    <JobStatus status="Due Today" />
                  )}
                  {dueDate && parseDate(dueDate) < todaysDate && (
                    <JobStatus status="Overdue" />
                  )}
                </>
              )}
            </HStack>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: jobStatus.map((status) => ({
              value: status,
              label: <JobStatus status={status} />
            }))
          },
          pluralHeader: "Statuses",
          icon: <LuUsers />
        }
      },
      {
        id: "assignee",
        header: "Assignee",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "startDate",
        header: "Start Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "dueDate",
        header: "Due Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "deadlineType",
        header: "Deadline Type",
        cell: ({ row }) => {
          const dueDate = row.original.dueDate!;
          const deadlineType = row.original.deadlineType!;

          if (!dueDate)
            return (
              <div className="flex gap-1 items-center">
                {getDeadlineIcon(deadlineType)}
                <span>{deadlineType}</span>
              </div>
            );

          return (
            <div className="flex items-center gap-1">
              {getDeadlineIcon(deadlineType)}
              <span>{deadlineType}</span>
            </div>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: deadlineTypes.map((type) => ({
              value: type,
              label: (
                <div className="flex gap-1 items-center">
                  {getDeadlineIcon(type)}
                  <span>{type}</span>
                </div>
              )
            }))
          },
          icon: <LuClock />
        }
      },
      {
        accessorKey: "tags",
        header: "Tags",
        cell: ({ row }) => (
          <HStack spacing={0} className="gap-1">
            {row.original.tags?.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: tags?.map((tag) => ({
              value: tag.name,
              label: <Badge variant="secondary">{tag.name}</Badge>
            })),
            isArray: true
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "orderQuantity",
        header: "Order Qty",
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "inventoryQuantity",
        header: "Inventory Qty",
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "productionQuantity",
        header: "Production Qty",
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "scrapQuantity",
        header: "Scrap Qty",
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "quantityComplete",
        header: "Completed Qty",
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "quantityShipped",
        header: "Shipped Qty",
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "quantityReceivedToInventory",
        header: "Received Qty",
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "locationId",
        header: "Location",
        cell: ({ row }) => (
          <Enumerable
            value={
              locations.find((l) => l.value === row.original.locationId)
                ?.label ?? null
            }
          />
        ),
        meta: {
          icon: <LuMapPin />,
          filter: {
            type: "static",
            options: locations.map((l) => ({
              value: l.value,
              label: <Enumerable value={l.label} />
            }))
          }
        }
      },
      {
        id: "createdBy",
        header: "Created By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "updatedBy",
        header: "Updated By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "updatedAt",
        header: "Updated At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [params, customColumns, trackedEntities]);

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onBulkUpdate = useCallback(
    (selectedRows: typeof data, field: "delete", value?: string) => {
      const formData = new FormData();
      selectedRows.forEach((row) => {
        if (row.id) formData.append("ids", row.id);
      });
      formData.append("field", field);
      if (value) formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateJob
      });
    },

    []
  );

  const renderActions = useCallback(
    (selectedRows: typeof data) => {
      return (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>Update</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={
                !permissions.can("delete", "production") ||
                selectedRows.some(
                  (row) =>
                    ![
                      "Draft",
                      "Planned",
                      "Due Today",
                      "Overdue",
                      "Draft"
                    ].includes(row.status ?? "")
                )
              }
              destructive
              onClick={() => onBulkUpdate(selectedRows, "delete")}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Jobs
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      );
    },
    [onBulkUpdate, permissions]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const renderContextMenu = useCallback<(row: Job) => JSX.Element>(
    (row) => (
      <>
        <MenuItem
          onClick={() => {
            navigate(path.to.job(row.id!));
          }}
        >
          <MenuIcon icon={<LuPencil />} />
          Edit Job
        </MenuItem>
        <MenuItem
          destructive
          disabled={!permissions.can("delete", "production")}
          onClick={() => onDelete(row)}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete Job
        </MenuItem>
      </>
    ),

    [navigate, params, permissions]
  );

  return (
    <>
      <Table<Job>
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={{
          left: ["jobId"]
        }}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          permissions.can("update", "resources") && (
            <New label="Job" to={path.to.newJob} />
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title="Jobs"
        table="job"
        withSavedView
        withSelectableRows
      />

      {selectedJob && selectedJob.id && (
        <ConfirmDelete
          action={path.to.deleteJob(selectedJob.id)}
          name={selectedJob?.jobId ?? ""}
          text={`Are you sure you want to delete the job: ${selectedJob?.jobId}?`}
          isOpen={deleteModal.isOpen}
          onCancel={onDeleteCancel}
          onSubmit={onDeleteCancel}
        />
      )}
    </>
  );
});

JobsTable.displayName = "JobsTable";
export default JobsTable;
