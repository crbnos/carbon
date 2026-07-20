import { Badge, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuArrowRight,
  LuBlocks,
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
import { useItems } from "~/stores/items";
import { usePeople } from "~/stores/people";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  type ChangeOrderChangeType,
  changeOrderPriority,
  changeOrderStatus
} from "../../items.models";
import type { ChangeOrderListItem } from "../../types";
import ChangeOrderPriority from "./ChangeOrderPriority";
import ChangeOrderStatus from "./ChangeOrderStatus";
import ChangeTypeBadge from "./ChangeTypeBadge";

type ChangeOrdersTableProps = {
  data: ChangeOrderListItem[];
  types: ListItem[];
  count: number;
};

// One entry of the changeOrders view's `affectedItems` jsonb rollup — enough to
// render the expanded row (item label + change type + OLD→NEW), resolving ids to
// readable ids client-side via the items store.
type AffectedItemSummary = {
  id: string;
  itemId: string;
  changeType: ChangeOrderChangeType;
  newItemId: string | null;
};

const ChangeOrdersTable = memo(
  ({ data, types, count }: ChangeOrdersTableProps) => {
    const navigate = useNavigate();
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedChangeOrder, setSelectedChangeOrder] =
      useState<ChangeOrderListItem | null>(null);

    const customColumns = useCustomColumns<ChangeOrderListItem>("changeOrder");
    const [people] = usePeople();
    const [items] = useItems();

    const itemsById = useMemo(
      () => new Map((items ?? []).map((i) => [i.id, i.readableIdWithRevision])),
      [items]
    );
    const resolveItemId = useCallback(
      (id?: string | null) => (id ? (itemsById.get(id) ?? id) : null),
      [itemsById]
    );

    useRealtime("changeOrder");

    const columns = useMemo<ColumnDef<ChangeOrderListItem>[]>(() => {
      const defaultColumns: ColumnDef<ChangeOrderListItem>[] = [
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
          accessorKey: "itemIds",
          header: t`Items`,
          cell: ({ row }) => {
            const ids = row.original.itemIds ?? [];
            if (ids.length === 0)
              return <span className="text-muted-foreground">—</span>;
            const shown = ids.slice(0, 2);
            const extra = ids.length - shown.length;
            return (
              <div className="flex items-center gap-1">
                {shown.map((id) => (
                  <Badge key={id} variant="outline">
                    {resolveItemId(id)}
                  </Badge>
                ))}
                {extra > 0 && <Badge variant="secondary">{`+${extra}`}</Badge>}
              </div>
            );
          },
          meta: {
            icon: <LuBlocks />,
            pluralHeader: t`Items`,
            filter: {
              type: "static",
              options: (items ?? []).map((item) => ({
                value: item.id,
                label: item.readableIdWithRevision
              })),
              isArray: true
            },
            exportValue: (row: ChangeOrderListItem) =>
              (row.itemIds ?? []).map((id) => resolveItemId(id)).join(", ")
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
    }, [customColumns, people, items, resolveItemId, types, t, formatDate]);

    const canExpandRow = useCallback(
      (row: ChangeOrderListItem) => (row.itemIds?.length ?? 0) > 0,
      []
    );

    const renderExpandedRow = useCallback(
      (row: ChangeOrderListItem) => {
        const affectedItems =
          (row.affectedItems as AffectedItemSummary[]) ?? [];
        if (affectedItems.length === 0) return null;
        return (
          <div className="pl-[52px] pr-4">
            {affectedItems.map((affected) => {
              // A New Part is net-new (newItemId === itemId) — show a single id,
              // not "X → X". Only Revision/Replacement Part mint a distinct
              // successor worth arrowing to.
              const hasDistinctSuccessor =
                !!affected.newItemId && affected.newItemId !== affected.itemId;
              const newReadableId = hasDistinctSuccessor
                ? resolveItemId(affected.newItemId)
                : null;
              return (
                <div key={affected.id} className="flex gap-3 py-3 text-sm">
                  <div
                    aria-hidden
                    className="w-5 shrink-0 border-l border-border -my-3"
                  />
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {resolveItemId(affected.itemId)}
                    </span>
                    {newReadableId && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <LuArrowRight className="size-3.5 shrink-0" />
                        <span>{newReadableId}</span>
                      </span>
                    )}
                    <ChangeTypeBadge changeType={affected.changeType} />
                  </div>
                </div>
              );
            })}
          </div>
        );
      },
      [resolveItemId]
    );

    const renderContextMenu = useCallback(
      (row: ChangeOrderListItem) => {
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
        <Table<ChangeOrderListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "parts") && (
              <New label={t`Change Order`} to={path.to.newChangeOrder} />
            )
          }
          renderContextMenu={renderContextMenu}
          renderExpandedRow={renderExpandedRow}
          canExpandRow={canExpandRow}
          defaultColumnVisibility={{ itemIds: false }}
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
