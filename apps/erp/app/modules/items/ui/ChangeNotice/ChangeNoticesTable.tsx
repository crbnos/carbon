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
import { DateTime, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useRealtime } from "~/hooks/useRealtime";
import { useItems } from "~/stores/items";
import { usePeople } from "~/stores/people";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  type ChangeNoticeChangeType,
  changeNoticePriority,
  changeNoticeStatus
} from "../../items.models";
import type { ChangeNoticeListItem } from "../../types";
import ChangeNoticePriority from "./ChangeNoticePriority";
import ChangeNoticeStatus from "./ChangeNoticeStatus";
import ChangeTypeBadge from "./ChangeTypeBadge";

type ChangeNoticesTableProps = {
  data: ChangeNoticeListItem[];
  types: ListItem[];
  count: number;
};

// One entry of the changeOrders view's `affectedItems` jsonb rollup — enough to
// render the expanded row (item label + change type + OLD→NEW), resolving ids to
// readable ids client-side via the items store.
type AffectedItemSummary = {
  id: string;
  itemId: string;
  changeType: ChangeNoticeChangeType;
  newItemId: string | null;
};

const ChangeNoticesTable = memo(
  ({ data, types, count }: ChangeNoticesTableProps) => {
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedChangeNotice, setSelectedChangeNotice] =
      useState<ChangeNoticeListItem | null>(null);

    const customColumns = useCustomColumns<ChangeNoticeListItem>("changeOrder");
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

    const columns = useMemo<ColumnDef<ChangeNoticeListItem>[]>(() => {
      const defaultColumns: ColumnDef<ChangeNoticeListItem>[] = [
        {
          accessorKey: "changeOrderId",
          header: t`Change Notice`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.changeNotice(row.original.id!)}>
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
          cell: ({ row }) => (
            <ChangeNoticeStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuCircleGauge />,
            filter: {
              type: "static",
              options: changeNoticeStatus.map((status) => ({
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
            exportValue: (row: ChangeNoticeListItem) =>
              (row.itemIds ?? []).map((id) => resolveItemId(id)).join(", ")
          }
        },
        {
          accessorKey: "priority",
          header: t`Priority`,
          cell: ({ row }) => (
            <ChangeNoticePriority priority={row.original.priority} />
          ),
          meta: {
            icon: <LuSignal />,
            filter: {
              type: "static",
              options: changeNoticePriority.map((priority) => ({
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
          cell: ({ row }) => (
            <DateTime value={row.original.openDate} variant="date" />
          ),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns, people, items, resolveItemId, types, t]);

    const canExpandRow = useCallback(
      (row: ChangeNoticeListItem) => (row.itemIds?.length ?? 0) > 0,
      []
    );

    const renderExpandedRow = useCallback(
      (row: ChangeNoticeListItem) => {
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
      (row: ChangeNoticeListItem) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "parts")}
              onClick={() => {
                navigate(path.to.changeNotice(row.id!));
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {t`Edit Change Notice`}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "parts")}
              onClick={() => {
                flushSync(() => {
                  setSelectedChangeNotice(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              {t`Delete Change Notice`}
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure, t]
    );

    return (
      <>
        <Table<ChangeNoticeListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "parts") && (
              <New label={t`Change Notice`} to={path.to.newChangeNotice} />
            )
          }
          renderContextMenu={renderContextMenu}
          renderExpandedRow={renderExpandedRow}
          canExpandRow={canExpandRow}
          defaultColumnVisibility={{ itemIds: false }}
          title={t`Change Notices`}
          table="changeOrder"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedChangeNotice && (
          <ConfirmDelete
            action={path.to.deleteChangeNotice(selectedChangeNotice.id!)}
            isOpen
            onCancel={() => {
              setSelectedChangeNotice(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedChangeNotice(null);
              deleteDisclosure.onClose();
            }}
            name={selectedChangeNotice.name ?? "change notice"}
            text={t`Are you sure you want to delete this change notice?`}
          />
        )}
      </>
    );
  }
);

ChangeNoticesTable.displayName = "ChangeNoticesTable";
export default ChangeNoticesTable;
