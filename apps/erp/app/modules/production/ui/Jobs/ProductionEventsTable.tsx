import { Badge, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  New,
  Table,
  TimeTypeIcon
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions, useUrlParams } from "~/hooks";
import type { WorkCenter } from "~/modules/resources/types";
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
    const { t } = useLingui();
    if (!jobId) throw new Error("Job ID is required");
    const { formatDateTime } = useDateFormatter();
    const [people] = usePeople();

    const columns = useMemo<ColumnDef<ProductionEvent>[]>(() => {
      return [
        {
          accessorKey: "jobOperationId",
          header: t`Operation`,
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
                label: <Enumerable value={operation.description} />
              }))
            }
          }
        },
        {
          id: "item",
          header: t`Item`,
          cell: ({ row }) => {
            return row.original.jobOperation?.jobMakeMethod?.item
              ?.readableIdWithRevision;
          }
        },
        {
          accessorKey: "employeeId",
          header: t`Employee`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.employeeId} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: <Enumerable value={employee.name} />
              }))
            }
          }
        },
        {
          accessorKey: "type",
          header: t`Type`,
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
                )
              }))
            }
          }
        },
        {
          accessorKey: "duration",
          header: t`Duration`,
          cell: ({ row }) =>
            row.original.duration
              ? formatDurationMilliseconds(row.original.duration * 1000)
              : null
        },
        {
          accessorKey: "workCenterId",
          header: t`Work Center`,
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
                label: <Enumerable value={workCenter.name} />
              }))
            }
          }
        },
        {
          accessorKey: "startTime",
          header: t`Start Time`,
          cell: ({ row }) => formatDateTime(row.original.startTime)
        },
        {
          accessorKey: "endTime",
          header: t`End Time`,
          cell: ({ row }) =>
            row.original.endTime ? formatDateTime(row.original.endTime) : null
        },
        {
          accessorKey: "notes",
          header: t`Notes`,
          cell: ({ row }) => (
            <div
              className="max-w-[200px] truncate"
              title={row.original.notes ?? ""}
            >
              {row.original.notes}
            </div>
          )
        }
      ];
    }, [operations, people, workCenters, t]);

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

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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
            destructive
            disabled={!permissions.can("delete", "production")}
            onClick={() => onDelete(row)}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Event
          </MenuItem>
        </>
      ),

      [permissions]
    );
    const [params] = useUrlParams();

    return (
      <>
        <Table<ProductionEvent>
          compact
          count={count}
          columns={columns}
          data={data}
          primaryAction={
            permissions.can("update", "accounting") && (
              <New
                label={t`Production Event`}
                to={`new?${params.toString()}`}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Production Events`}
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
