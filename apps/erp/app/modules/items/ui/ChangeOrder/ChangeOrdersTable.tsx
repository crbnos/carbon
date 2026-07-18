import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBookMarked,
  LuCalendar,
  LuCircleGauge,
  LuGitPullRequestArrow,
  LuPencil,
  LuSignal,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useRealtime } from "~/hooks/useRealtime";
import { usePeople } from "~/stores/people";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  changeOrderPriority,
  changeOrderStatus
} from "../../changeOrder.models";
import type { ChangeOrder } from "../../types";
import ChangeOrderPriority from "./ChangeOrderPriority";
import ChangeOrderStatus from "./ChangeOrderStatus";

type ChangeOrdersTableProps = {
  data: ChangeOrder[];
  types: ListItem[];
  count: number;
};

const ChangeOrdersTable = memo(
  ({ data, types, count }: ChangeOrdersTableProps) => {
    const navigate = useNavigate();
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedChangeOrder, setSelectedChangeOrder] =
      useState<ChangeOrder | null>(null);

    const customColumns = useCustomColumns<ChangeOrder>("changeOrder");
    const [people] = usePeople();

    useRealtime("changeOrder");

    const columns = useMemo<ColumnDef<ChangeOrder>[]>(() => {
      const defaultColumns: ColumnDef<ChangeOrder>[] = [
        {
          accessorKey: "changeOrderId",
          header: t`Change Order`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.changeOrder(row.original.id!)}>
              <div className="flex flex-col gap-0">
                <span className="text-sm font-medium">
                  {row.original.changeOrderId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.original.name}
                </span>
              </div>
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => <ChangeOrderStatus status={row.original.status} />,
          meta: {
            icon: <LuCircleGauge />,
            filter: {
              type: "static",
              options: changeOrderStatus.map((status) => ({
                label: status,
                value: status
              }))
            }
          }
        },
        {
          accessorKey: "changeOrderTypeId",
          header: t`Category`,
          cell: ({ row }) => (
            <Enumerable
              value={
                types.find((type) => type.id === row.original.changeOrderTypeId)
                  ?.name ?? null
              }
            />
          ),
          meta: {
            icon: <LuGitPullRequestArrow />,
            filter: {
              type: "static",
              options: types.map((type) => ({
                label: type.name,
                value: type.id
              }))
            }
          }
        },
        {
          accessorKey: "priority",
          header: t`Priority`,
          cell: ({ row }) => (
            <ChangeOrderPriority priority={row.original.priority} />
          ),
          meta: {
            icon: <LuSignal />,
            filter: {
              type: "static",
              options: changeOrderPriority.map((priority) => ({
                label: priority,
                value: priority
              }))
            }
          }
        },
        {
          accessorKey: "assignee",
          header: t`Owner`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ),
          meta: {
            icon: <LuUser />,
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            }
          }
        },
        {
          accessorKey: "openDate",
          header: t`Open Date`,
          cell: ({ row }) => formatDate(row.original.openDate),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns, people, types, t, formatDate]);

    const renderContextMenu = useCallback(
      (row: ChangeOrder) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "parts")}
              onClick={() => {
                navigate(path.to.changeOrder(row.id!));
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {t`Edit Change Order`}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "parts")}
              onClick={() => {
                flushSync(() => {
                  setSelectedChangeOrder(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              {t`Delete Change Order`}
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure, t]
    );

    return (
      <>
        <Table<ChangeOrder>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "parts") && (
              <New label={t`Change Order`} to={path.to.newChangeOrder} />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Change Orders`}
          table="changeOrder"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedChangeOrder && (
          <ConfirmDelete
            action={path.to.deleteChangeOrder(selectedChangeOrder.id!)}
            isOpen
            onCancel={() => {
              setSelectedChangeOrder(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedChangeOrder(null);
              deleteDisclosure.onClose();
            }}
            name={selectedChangeOrder.name ?? "change order"}
            text={t`Are you sure you want to delete this change order?`}
          />
        )}
      </>
    );
  }
);

ChangeOrdersTable.displayName = "ChangeOrdersTable";
export default ChangeOrdersTable;
