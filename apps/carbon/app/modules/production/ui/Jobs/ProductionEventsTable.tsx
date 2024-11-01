import { Badge, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDateTime, formatDurationMilliseconds } from "@carbon/utils";
import { useNavigate, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import {
  EmployeeAvatar,
  Hyperlink,
  New,
  Table,
  TimeTypeIcon,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";
import type { WorkCenter } from "~/modules/resources";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { ProductionEvent } from "../../types";

type ProductionEventsTableProps = {
  data: ProductionEvent[];
  count: number;
  operations: { id: string; description: string | null }[];
  workCenters: WorkCenter[];
};

const ProductionEventsTable = memo(
  ({ data, count, operations, workCenters }: ProductionEventsTableProps) => {
    const { jobId } = useParams();
    if (!jobId) throw new Error("Job ID is required");
    const [people] = usePeople();

    const columns = useMemo<ColumnDef<ProductionEvent>[]>(() => {
      return [
        {
          accessorKey: "jobOperationId",
          header: "Operation",
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              {row.original.jobOperation?.description ?? null}
            </Hyperlink>
          ),
          meta: {
            filter: {
              type: "static",
              options: operations.map((operation) => ({
                value: operation.id,
                label: <Enumerable value={operation.description} />,
              })),
            },
          },
        },
        {
          id: "item",
          header: "Item",
          cell: ({ row }) => {
            return row.original.jobOperation?.jobMakeMethod?.item?.readableId;
          },
        },
        {
          accessorKey: "employeeId",
          header: "Employee",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.employeeId} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: <Enumerable value={employee.name} />,
              })),
            },
          },
        },
        {
          accessorKey: "type",
          header: "Type",
          cell: ({ row }) => (
            <Badge
              variant={
                row.original.type === "Labor"
                  ? "green"
                  : row.original.type === "Machine"
                  ? "blue"
                  : "yellow"
              }
            >
              <TimeTypeIcon type={row.original.type ?? ""} className="mr-2" />
              {row.original.type}
            </Badge>
          ),
          meta: {
            filter: {
              type: "static",
              options: ["Setup", "Labor", "Machine"].map((type) => ({
                value: type,
                label: (
                  <Badge
                    variant={
                      type === "Labor"
                        ? "green"
                        : type === "Machine"
                        ? "blue"
                        : "yellow"
                    }
                  >
                    <TimeTypeIcon type={type} className="mr-2" />
                    {type}
                  </Badge>
                ),
              })),
            },
          },
        },
        {
          accessorKey: "duration",
          header: "Duration",
          cell: ({ row }) =>
            row.original.duration
              ? formatDurationMilliseconds(row.original.duration * 1000)
              : null,
        },
        {
          accessorKey: "workCenterId",
          header: "Work Center",
          cell: ({ row }) => {
            const workCenter = workCenters.find(
              (wc) => wc.id === row.original.workCenterId
            );
            return <Enumerable value={workCenter?.name ?? null} />;
          },
          meta: {
            filter: {
              type: "static",
              options: workCenters.map((workCenter) => ({
                value: workCenter.id!,
                label: <Enumerable value={workCenter.name} />,
              })),
            },
          },
        },
        {
          accessorKey: "startTime",
          header: "Start Time",
          cell: ({ row }) => formatDateTime(row.original.startTime),
        },
        {
          accessorKey: "endTime",
          header: "End Time",
          cell: ({ row }) =>
            row.original.endTime ? formatDateTime(row.original.endTime) : null,
        },
      ];
    }, [operations, people, workCenters]);

    const permissions = usePermissions();

    const deleteModal = useDisclosure();
    const [selectedEvent, setSelectedEvent] = useState<ProductionEvent | null>(
      null
    );

    const onDelete = (data: ProductionEvent) => {
      setSelectedEvent(data);
      deleteModal.onOpen();
    };

    const onDeleteCancel = () => {
      setSelectedEvent(null);
      deleteModal.onClose();
    };

    const navigate = useNavigate();

    const renderContextMenu = useCallback<
      (row: ProductionEvent) => JSX.Element
    >(
      (row) => (
        <>
          <MenuItem
            disabled={!permissions.can("update", "production")}
            onClick={() => navigate(row.id)}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Event
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "users")}
            onClick={() => onDelete(row)}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Event
          </MenuItem>
        </>
      ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [permissions]
    );
    const [params] = useUrlParams();

    return (
      <>
        <Table<ProductionEvent>
          count={count}
          columns={columns}
          data={data}
          primaryAction={
            permissions.can("update", "accounting") && (
              <New label="Production Event" to={`new?${params.toString()}`} />
            )
          }
          renderContextMenu={renderContextMenu}
        />
        {deleteModal.isOpen && selectedEvent && (
          <ConfirmDelete
            action={path.to.deleteProductionEvent(selectedEvent.id)}
            isOpen
            name={`${
              selectedEvent.jobOperation?.description ?? "Operation"
            } by ${
              people.find((p) => p.id === selectedEvent.employeeId)?.name ??
              "Unknown Employee"
            }`}
            text="Are you sure you want to delete this production event? This action cannot be undone."
            onCancel={onDeleteCancel}
            onSubmit={onDeleteCancel}
          />
        )}
      </>
    );
  }
);

ProductionEventsTable.displayName = "ProductionEventsTable";

export default ProductionEventsTable;
