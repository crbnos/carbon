// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCalendarClock,
  LuCalendarCog,
  LuCheck,
  LuFile,
  LuHash,
  LuList,
  LuNetwork,
  LuQrCode,
  LuRotateCcw,
  LuText,
  LuToggleRight,
  LuTriangleAlert
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import type { InfiniteOptions } from "~/components/Table";
import type { ColumnFilterData } from "~/components/Table/components/Filter/types";
import { useDateFormatter, useDrawerItem, usePermissions } from "~/hooks";
import { trackedEntityStatus } from "~/modules/inventory/inventory.models";
import {
  type BatchPropertyColumn,
  batchPropertyExportValue,
  batchPropertyValue
} from "~/modules/inventory/inventory.utils";
import type { TrackedEntity } from "~/modules/inventory/types";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { Item } from "~/stores/items";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { EditExpiryModal } from "./EditExpiryModal";
import { ExpiryTracePopover } from "./ExpiryTracePopover";
import TrackedEntityStatus from "./TrackedEntityStatus";
import { UnscrapModal } from "./UnscrapModal";

type ShelfLifePolicy = {
  mode: string;
  days: number | null;
  calculateFromBom?: boolean | null;
};

// A row of the list, with its item's shelf-life policy (from the loader), so
// the Expiry trace popover can show the Policy step.
type TrackedEntityRow = TrackedEntity & {
  shelfLifePolicy: ShelfLifePolicy | null;
};

type TrackedEntitiesTableProps = {
  data: TrackedEntityRow[];
  count: number;
  infinite: InfiniteOptions;
  nearExpiryWarningDays: number | null;
  batchPropertyColumns: BatchPropertyColumn[];
};

const TrackedEntitiesTable = memo(
  ({
    data,
    count,
    infinite,
    nearExpiryWarningDays,
    batchPropertyColumns
  }: TrackedEntitiesTableProps) => {
    const navigate = useNavigate();
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const permissions = usePermissions();
    const numberFormatter = useNumberFormatter();
    const [items] = useItems();

    // Edit-expiry modal state. Holds the entity being edited so the modal
    // can pre-fill its form. Lives at table level so the row context-menu
    // action can open it.
    const unscrap = useDrawerItem<TrackedEntity>();
    const unscrapping = unscrap.item;

    const editExpiry = useDrawerItem<TrackedEntity>();
    const editingExpiry = editExpiry.item;

    const yesNo = useMemo(() => ({ yes: t`Yes`, no: t`No` }), [t]);

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(
      () => [
        {
          accessorKey: "sourceDocumentId",
          header: t`Entity`,
          cell: ({ row }) => (
            <Hyperlink
              to={`${path.to.traceabilityGraph}?trackedEntityId=${row.original.id}`}
            >
              <div className="flex flex-col items-start gap-0">
                <span>{row.original.sourceDocumentReadableId}</span>
                <span className="text-xs text-muted-foreground">
                  {row.original.id}
                </span>
              </div>
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookMarked />,

            filter: {
              type: "static",
              options: items.map((i) => ({
                label: i.readableIdWithRevision,
                value: i.id
              }))
            }
          }
        },
        {
          accessorKey: "readableId",
          header: t`Serial/Batch #`,
          cell: ({ row }) =>
            row.original.readableId ? (
              <Badge variant="secondary" className="items-center gap-1">
                <LuQrCode />
                {row.original.readableId}
              </Badge>
            ) : null,
          meta: {
            mobile: "P3",
            icon: <LuHash />
          }
        },
        {
          accessorKey: "quantity",
          header: t`Quantity`,
          cell: ({ row }) => (
            <span>{numberFormatter.format(row.original.quantity)}</span>
          ),
          meta: {
            mobile: "P2",
            icon: <LuHash />,
            renderTotal: true
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <TrackedEntityStatus status={row.original.status} />
          ),
          meta: {
            mobile: "P2",
            icon: <LuCheck />,
            filter: {
              type: "static",
              options: trackedEntityStatus
                .filter((v) => v !== "Reserved")
                .map((v) => ({
                  label: <TrackedEntityStatus status={v} />,
                  value: v
                }))
            }
          }
        },
        {
          id: "expirationDate",
          accessorKey: "expirationDate",
          header: t`Expiry`,
          cell: ({ row }) => {
            const expiry = row.original.expirationDate ?? undefined;
            if (!expiry) return null;
            const status = row.original.status;
            const formatted = formatDate(expiry);
            // Use @internationalized/date so the comparison runs in the
            // operator's local calendar, not UTC. Avoids the off-by-one
            // around midnight that pure UTC `Date` arithmetic causes.
            const todayLocal = today(getLocalTimeZone());
            const expiryDate = parseDate(expiry);
            const daysLeft = expiryDate.compare(todayLocal);
            const inner =
              status === "Consumed" ? (
                <Badge variant="secondary" className="gap-1">
                  {daysLeft < 0 ? `${t`Expired`} · ${formatted}` : formatted}
                </Badge>
              ) : daysLeft < 0 ? (
                <Badge variant="red" className="gap-1">
                  <LuTriangleAlert className="size-3" />
                  {t`Expired`} · {formatted}
                </Badge>
              ) : nearExpiryWarningDays !== null &&
                daysLeft <= nearExpiryWarningDays ? (
                <Badge variant="yellow" className="gap-1">
                  <LuTriangleAlert className="size-3" />
                  {formatted}
                </Badge>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {formatted}
                </span>
              );
            const policy = row.original.shelfLifePolicy;
            return (
              <ExpiryTracePopover
                entity={row.original}
                policy={
                  policy
                    ? {
                        mode: policy.mode as
                          | "Fixed Duration"
                          | "Calculated"
                          | "Set on Receipt",
                        days: policy.days,
                        calculateFromBom: policy.calculateFromBom ?? false
                      }
                    : null
                }
              >
                {inner}
              </ExpiryTracePopover>
            );
          },
          meta: {
            filter: {
              type: "dateRange"
            },
            icon: <LuCalendarClock />
          }
        },
        {
          accessorKey: "sourceDocument",
          header: t`Source Document`,
          cell: ({ row }) => (
            <SourceDocumentLink data={row.original} items={items} />
          ),
          meta: {
            icon: <LuFile />
          }
        },
        // One column per batch property label, across items. Hidden until
        // shown; its filter is always in the filter menu.
        ...batchPropertyColumns.map(
          (column): ColumnDef<(typeof data)[number]> => ({
            id: column.key,
            header: column.label,
            enableSorting: false,
            cell: ({ row }) =>
              formatPropertyValue(
                column,
                batchPropertyValue(column, row.original),
                formatDate,
                yesNo
              ),
            meta: {
              icon: <PropertyIcon dataType={column.dataType} />,
              exportValue: (row) => batchPropertyExportValue(column, row),
              filter: propertyFilter(column, yesNo)
            }
          })
        )
      ],
      [
        numberFormatter,
        items,
        t,
        nearExpiryWarningDays,
        formatDate,
        batchPropertyColumns,
        yesNo
      ]
    );

    const defaultColumnVisibility = useMemo(
      () =>
        Object.fromEntries(
          batchPropertyColumns.map((column) => [column.key, false])
        ),
      [batchPropertyColumns]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.view}
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(
                  `${path.to.traceabilityGraph}?trackedEntityId=${row.id}`
                );
              }}
            >
              <MenuIcon icon={<LuNetwork />} />
              <Trans>View Traceability Graph</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              disabled={
                !permissions.can("update", "inventory") ||
                row.status === "Consumed"
              }
              onClick={() => editExpiry.open(row)}
            >
              <MenuIcon icon={<LuCalendarCog />} />
              <Trans>Edit Expiry</Trans>
            </MenuItem>
            {row.status === "Scrapped" && (
              <MenuItem
                disabled={
                  !permissions.can("update", "inventory") || !row.itemId
                }
                onClick={() => unscrap.open(row)}
              >
                <MenuIcon icon={<LuRotateCcw />} />
                <Trans>Unscrap</Trans>
              </MenuItem>
            )}
          </>
        );
      },
      [navigate, permissions, editExpiry.open, unscrap.open]
    );

    return (
      <>
        <Table<(typeof data)[number]>
          data={data}
          infinite={infinite}
          columns={columns}
          count={count}
          renderContextMenu={renderContextMenu}
          defaultColumnVisibility={defaultColumnVisibility}
          title={t`Tracked Entities`}
        />
        {editingExpiry && editingExpiry.status !== "Consumed" && (
          <EditExpiryModal
            open={editExpiry.isOpen}
            onClose={editExpiry.close}
            trackedEntityId={editingExpiry.id}
            expirationDate={editingExpiry.expirationDate ?? null}
            label={editingExpiry.sourceDocumentReadableId ?? editingExpiry.id}
          />
        )}
        {unscrapping &&
          unscrapping.itemId &&
          Number.isFinite(Number(unscrapping.quantity)) &&
          Number(unscrapping.quantity) > 0 && (
            <UnscrapModal
              open={unscrap.isOpen}
              onClose={unscrap.close}
              itemId={unscrapping.itemId}
              trackedEntityId={unscrapping.id}
              quantity={Number(unscrapping.quantity)}
              label={
                unscrapping.readableId ??
                unscrapping.sourceDocumentReadableId ??
                unscrapping.id
              }
            />
          )}
      </>
    );
  }
);

function SourceDocumentLink({
  data,
  items
}: {
  data: TrackedEntity;
  items: Item[];
}) {
  switch (data.sourceDocument) {
    case "Item":
      const item = items.find((item) => item.id === data.sourceDocumentId);
      if (!item) return <Enumerable value={data.sourceDocument} />;
      return (
        // @ts-expect-error
        <Hyperlink to={getLinkToItemDetails(item.type, item.id)}>
          <Enumerable value={data.sourceDocument} />
        </Hyperlink>
      );
    default:
      return <Enumerable value={data.sourceDocument} />;
  }
}

type YesNo = { yes: string; no: string };

function propertyFilter(
  column: BatchPropertyColumn,
  yesNo: YesNo
): ColumnFilterData {
  switch (column.dataType) {
    case "boolean":
      return {
        type: "static",
        options: [
          { value: "true", label: yesNo.yes },
          { value: "false", label: yesNo.no }
        ]
      };
    case "list":
      return {
        type: "static",
        options: column.listOptions.map((option) => ({
          value: option,
          label: <Enumerable value={option} />
        }))
      };
    case "date":
      return { type: "dateRange" };
    default:
      return {
        type: "fetcher",
        endpoint: path.to.api.batchPropertyValues(column.key)
      };
  }
}

function formatPropertyValue(
  column: BatchPropertyColumn,
  value: unknown,
  formatDate: (date: string) => string,
  yesNo: YesNo
) {
  if (value === undefined || value === null || value === "") return null;
  switch (column.dataType) {
    case "boolean":
      return value === true || value === "true" ? yesNo.yes : yesNo.no;
    case "date":
      return typeof value === "string" ? formatDate(value) : String(value);
    case "list":
      return <Enumerable value={String(value)} />;
    default:
      return String(value);
  }
}

function PropertyIcon({
  dataType
}: {
  dataType: BatchPropertyColumn["dataType"];
}) {
  switch (dataType) {
    case "boolean":
      return <LuToggleRight />;
    case "date":
      return <LuCalendar />;
    case "list":
      return <LuList />;
    case "numeric":
      return <LuHash />;
    default:
      return <LuText />;
  }
}

TrackedEntitiesTable.displayName = "TrackedEntitiesTable";
export default TrackedEntitiesTable;
