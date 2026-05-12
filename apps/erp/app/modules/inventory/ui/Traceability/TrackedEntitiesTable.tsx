import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendarClock,
  LuCalendarCog,
  LuCheck,
  LuFile,
  LuHash,
  LuNetwork,
  LuQrCode,
  LuTriangleAlert
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter, usePermissions } from "~/hooks";
import type { TrackedEntity } from "~/modules/inventory";
import { trackedEntityStatus } from "~/modules/inventory";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { Item } from "~/stores/items";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { EditExpiryModal } from "./EditExpiryModal";
import { ExpiryTracePopover } from "./ExpiryTracePopover";
import TrackedEntityStatus from "./TrackedEntityStatus";

type ShelfLifePolicy = {
  mode: string;
  days: number | null;
  calculateFromBom?: boolean | null;
};

type TrackedEntitiesTableProps = {
  data: TrackedEntity[];
  count: number;
  nearExpiryWarningDays: number | null;
  shelfLifePolicies?: Record<string, ShelfLifePolicy>;
};

const TrackedEntitiesTable = memo(
  ({
    data,
    count,
    nearExpiryWarningDays,
    shelfLifePolicies
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
    const [editingExpiry, setEditingExpiry] = useState<TrackedEntity | null>(
      null
    );

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
            const itemId = (row.original as { itemId?: string | null }).itemId;
            const policy = itemId ? shelfLifePolicies?.[itemId] : undefined;
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
        }
      ],
      [
        numberFormatter,
        items,
        t,
        nearExpiryWarningDays,
        shelfLifePolicies,
        formatDate
      ]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
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
              disabled={
                !permissions.can("update", "inventory") ||
                row.status === "Consumed"
              }
              onClick={() => setEditingExpiry(row)}
            >
              <MenuIcon icon={<LuCalendarCog />} />
              <Trans>Edit Expiry</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, permissions]
    );

    return (
      <>
        <Table<(typeof data)[number]>
          data={data}
          columns={columns}
          count={count}
          renderContextMenu={renderContextMenu}
          title={t`Tracked Entities`}
        />
        {editingExpiry && editingExpiry.status !== "Consumed" && (
          <EditExpiryModal
            open={!!editingExpiry}
            onClose={() => setEditingExpiry(null)}
            trackedEntityId={editingExpiry.id}
            expirationDate={editingExpiry.expirationDate ?? null}
            label={editingExpiry.sourceDocumentReadableId ?? editingExpiry.id}
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
        // @ts-ignore
        <Hyperlink to={getLinkToItemDetails(item.type, item.id)}>
          <Enumerable value={data.sourceDocument} />
        </Hyperlink>
      );
    default:
      return <Enumerable value={data.sourceDocument} />;
  }
}

TrackedEntitiesTable.displayName = "TrackedEntitiesTable";
export default TrackedEntitiesTable;
