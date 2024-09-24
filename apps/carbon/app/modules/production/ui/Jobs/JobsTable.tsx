import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table,
} from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Job } from "~/modules/production";
import {
  deadlineTypes,
  getDeadlineIcon,
  getDeadlineText,
  jobStatus,
  JobStatus,
} from "~/modules/production";
import { useCustomers, useFixtures, useParts, usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type JobsTableProps = {
  data: Job[];
  count: number;
  locations: ListItem[];
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
  quantityReceivedToInventory: false,
};

const JobsTable = memo(({ data, count, locations }: JobsTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const parts = useParts();
  const fixtures = useFixtures();

  const items = useMemo(() => [...parts, ...fixtures], [parts, fixtures]);

  const [people] = usePeople();
  const [customers] = useCustomers();

  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const onDelete = (data: Job) => {
    setSelectedJob(data);
    deleteModal.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedJob(null);
    deleteModal.onClose();
  };

  const customColumns = useCustomColumns<Job>("job");
  const columns = useMemo<ColumnDef<Job>[]>(() => {
    const defaultColumns: ColumnDef<Job>[] = [
      {
        accessorKey: "jobId",
        header: "Job ID",
        cell: ({ row }) => (
          <Hyperlink to={path.to.job(row.original.id!)}>
            {row.original?.jobId}
          </Hyperlink>
        ),
      },
      {
        accessorKey: "itemReadableId",
        header: "Item",
        cell: (item) => item.getValue(),
        meta: {
          filter: {
            type: "static",
            options: items?.map((item) => ({
              value: item.readableId,
              label: item.readableId,
            })),
          },
        },
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
              label: customer.name,
            })),
          },
        },
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
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (item) => {
          const status = item.getValue<(typeof jobStatus)[number]>();
          return <JobStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: jobStatus.map((status) => ({
              value: status,
              label: <JobStatus status={status} />,
            })),
          },
          pluralHeader: "Statuses",
        },
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
              label: employee.name,
            })),
          },
        },
      },
      {
        accessorKey: "dueDate",
        header: "Due Date",
        cell: (item) => formatDate(item.getValue<string>()),
      },
      {
        accessorKey: "deadlineType",
        header: "Deadline Type",
        cell: ({ row }) => {
          const dueDate = row.original.dueDate!;
          const deadlineType = row.original.deadlineType!;
          const isOverdue = new Date(dueDate) < new Date();

          if (!dueDate)
            return (
              <div className="flex gap-1 items-center">
                {getDeadlineIcon(deadlineType, false)}
                <span>{getDeadlineText(deadlineType)}</span>
              </div>
            );

          return (
            <div className="flex items-center gap-1">
              {getDeadlineIcon(deadlineType, isOverdue)}
              <span>{getDeadlineText(deadlineType)}</span>
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
                  {getDeadlineIcon(type, false)}
                  <span>{getDeadlineText(type)}</span>
                </div>
              ),
            })),
          },
        },
      },
      {
        accessorKey: "orderQuantity",
        header: "Order Qty",
        cell: (item) => item.getValue<number>(),
      },
      {
        accessorKey: "inventoryQuantity",
        header: "Inventory Qty",
        cell: (item) => item.getValue<number>(),
      },
      {
        accessorKey: "productionQuantity",
        header: "Production Qty",
        cell: (item) => item.getValue<number>(),
      },
      {
        accessorKey: "scrapQuantity",
        header: "Scrap Qty",
        cell: (item) => item.getValue<number>(),
      },
      {
        accessorKey: "quantityComplete",
        header: "Completed Qty",
        cell: (item) => item.getValue<number>(),
      },
      {
        accessorKey: "quantityShipped",
        header: "Shipped Qty",
        cell: (item) => item.getValue<number>(),
      },
      {
        accessorKey: "quantityReceivedToInventory",
        header: "Received Qty",
        cell: (item) => item.getValue<number>(),
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
              label: employee.name,
            })),
          },
        },
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
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
              label: employee.name,
            })),
          },
        },
      },
      {
        accessorKey: "updatedAt",
        header: "Updated At",
        cell: (item) => formatDate(item.getValue<string>()),
      },
    ];
    return [...defaultColumns, ...customColumns];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, customColumns]);

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
          disabled={!permissions.can("delete", "users")}
          onClick={() => onDelete(row)}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete Job
        </MenuItem>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, params, permissions]
  );

  return (
    <>
      <Table<Job>
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          permissions.can("update", "resources") && (
            <New label="Job" to={path.to.newJob} />
          )
        }
        renderContextMenu={renderContextMenu}
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
