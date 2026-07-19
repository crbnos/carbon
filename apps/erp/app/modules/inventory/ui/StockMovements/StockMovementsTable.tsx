import { Badge, HStack, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArrowRightLeft,
  LuBlocks,
  LuCalendar,
  LuCornerDownRight,
  LuFileText,
  LuHash,
  LuMapPin,
  LuMoveDown,
  LuMoveUp,
  LuQrCode,
  LuUser,
  LuWarehouse,
  LuWrench
} from "react-icons/lu";
import { Link } from "react-router";
import { EmployeeAvatar, Hyperlink, ItemThumbnail, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useDateFormatter, useUser } from "~/hooks";
import { useDebouncedRealtime } from "~/hooks/useDebouncedRealtime";
import type { MethodItemType } from "~/modules/shared";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import {
  itemLedgerDocumentTypes,
  itemLedgerTypes
} from "../../inventory.models";
import type { StockMovement } from "../../types";

type StockMovementsTableProps = {
  data: StockMovement[];
  count: number;
};

const StockMovementsTable = memo(
  ({ data, count }: StockMovementsTableProps) => {
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const { company } = useUser();
    const [people] = usePeople();
    const locations = useLocations();
    const locationsById = useMemo(
      () => new Map(locations.map((l) => [l.value, l.label])),
      [locations]
    );

    // Company-wide realtime: a single posting can insert many itemLedger rows
    // at once, so coalesce the burst into one route revalidation (1.5s debounce
    // inside useDebouncedRealtime) rather than revalidating per event.
    useDebouncedRealtime("itemLedger", `companyId=eq.${company.id}`);

    const columns = useMemo<ColumnDef<StockMovement>[]>(() => {
      return [
        {
          accessorKey: "itemReadableId",
          header: t`Item`,
          cell: ({ row }) => (
            <HStack className="py-1">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                type={row.original.itemType as MethodItemType}
              />
              <Hyperlink to={getInventoryItemActivityPath(row.original)}>
                <VStack spacing={0}>
                  <span>{row.original.itemReadableId}</span>
                  {row.original.itemDescription && (
                    <span className="text-muted-foreground text-xs">
                      {row.original.itemDescription}
                    </span>
                  )}
                </VStack>
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuBlocks />
          }
        },
        {
          accessorKey: "entryType",
          header: t`Entry Type`,
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: itemLedgerTypes.map((type) => ({
                value: type,
                label: <Enumerable value={type} />
              }))
            },
            icon: <LuArrowRightLeft />
          }
        },
        {
          accessorKey: "documentType",
          header: t`Document Type`,
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: itemLedgerDocumentTypes.map((type) => ({
                value: type,
                label: <Enumerable value={type} />
              }))
            },
            icon: <LuFileText />
          }
        },
        {
          accessorKey: "isCorrection",
          header: t`Correction`,
          cell: ({ row }) =>
            isCorrectionRow(row.original) ? (
              <Badge variant="yellow">{t`Correction`}</Badge>
            ) : (
              ""
            ),
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: t`Correction` },
                { value: "false", label: t`Original` }
              ]
            },
            pluralHeader: t`Corrections`,
            icon: <LuWrench />,
            // Export the corrected movement's id so the CSV keeps the linkage.
            exportValue: (row: StockMovement) =>
              row.correctionOfItemLedgerId ?? ""
          }
        },
        {
          accessorKey: "quantity",
          header: t`Quantity`,
          cell: ({ row }) => <QuantityDelta value={row.original.quantity} />,
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => (
            <Enumerable
              value={
                row.original.locationId
                  ? (locationsById.get(row.original.locationId) ?? null)
                  : null
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: locations.map((location) => ({
                value: location.value,
                label: <Enumerable value={location.label} />
              }))
            },
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "storageUnitName",
          header: t`Storage Unit`,
          cell: ({ row }) => row.original.storageUnitName ?? "",
          meta: {
            icon: <LuWarehouse />
          }
        },
        {
          accessorKey: "trackedEntityReadableId",
          header: t`Tracked Entity`,
          cell: ({ row }) => {
            const trackedEntityId = row.original.trackedEntityId;
            const label =
              row.original.trackedEntityReadableId || trackedEntityId;
            if (!trackedEntityId) return label ?? "";
            return (
              <Link
                prefetch="intent"
                to={`${path.to.traceabilityGraph}?trackedEntityId=${trackedEntityId}`}
                className="text-foreground hover:underline"
              >
                {label}
              </Link>
            );
          },
          meta: {
            icon: <LuQrCode />
          }
        },
        {
          accessorKey: "postingDate",
          header: t`Posting Date`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "createdBy",
          header: t`Created By`,
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
          header: t`Created At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
    }, [people, locations, locationsById, t, formatDate]);

    // Group corrections under the movement they fix. Corrections whose original
    // is on this page are hidden from the flat list and revealed by expanding the
    // original (chevron), like the accounting/audit-log expandable rows. A
    // correction whose original isn't on the page stays inline (still badged).
    const { displayData, correctionsByOriginal } = useMemo(() => {
      const byId = new Map(data.map((m) => [m.id, m]));

      // Walk a correction up its `correctionOfItemLedgerId` chain to the topmost
      // ancestor present on this page. Corrections can chain (a rectification of
      // a rectification links to the prior correction, not the original), so we
      // must resolve to the ULTIMATE root — otherwise a grandchild correction
      // would be hidden but never re-shown under any visible row.
      const rootOf = (m: StockMovement) => {
        let cur = m;
        const seen = new Set<string>();
        while (
          cur.correctionOfItemLedgerId &&
          byId.has(cur.correctionOfItemLedgerId) &&
          cur.id &&
          !seen.has(cur.id)
        ) {
          seen.add(cur.id);
          cur = byId.get(cur.correctionOfItemLedgerId) as StockMovement;
        }
        return cur;
      };

      const byOriginal = new Map<string, StockMovement[]>();
      const nestedIds = new Set<string>();
      for (const m of data) {
        if (!m.correctionOfItemLedgerId) continue;
        const root = rootOf(m);
        // No on-page ancestor (root resolves back to itself) → leave inline.
        if (!root.id || root.id === m.id) continue;
        const list = byOriginal.get(root.id) ?? [];
        list.push(m);
        byOriginal.set(root.id, list);
        if (m.id) nestedIds.add(m.id);
      }
      // Order each group oldest-first so a chain reads original → fix → fix.
      for (const list of byOriginal.values()) {
        list.sort((a, b) => (a.entryNumber ?? 0) - (b.entryNumber ?? 0));
      }
      return {
        correctionsByOriginal: byOriginal,
        displayData:
          nestedIds.size === 0
            ? data
            : data.filter((m) => !(m.id && nestedIds.has(m.id)))
      };
    }, [data]);

    const canExpandRow = useCallback(
      (row: StockMovement) => !!row.id && correctionsByOriginal.has(row.id),
      [correctionsByOriginal]
    );

    const renderExpandedRow = useCallback(
      (row: StockMovement) => {
        const corrections = row.id
          ? correctionsByOriginal.get(row.id)
          : undefined;
        if (!corrections?.length) return null;
        return (
          <div className="pl-[52px] pr-4">
            {corrections.map((c) => (
              <div
                key={c.id}
                className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-sm"
              >
                <LuCornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 items-center gap-2.5">
                  <Badge variant="yellow" className="shrink-0">
                    {t`Correction`}
                  </Badge>
                  <Enumerable value={c.entryType} />
                  <QuantityDelta value={c.quantity} />
                  <span className="truncate text-muted-foreground">
                    {c.storageUnitName ?? c.locationName ?? "—"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  <span className="tabular-nums text-xs">
                    {formatDate(c.postingDate)}
                  </span>
                  <EmployeeAvatar employeeId={c.createdBy} />
                </div>
              </div>
            ))}
          </div>
        );
      },
      [correctionsByOriginal, formatDate, t]
    );

    return (
      <Table<(typeof data)[number]>
        data={displayData}
        columns={columns}
        count={count}
        defaultColumnPinning={{
          left: ["itemReadableId"]
        }}
        renderExpandedRow={renderExpandedRow}
        canExpandRow={canExpandRow}
        title={t`Inventory Movements`}
        table="itemLedger"
        withSavedView
      />
    );
  }
);

StockMovementsTable.displayName = "StockMovementsTable";
export default StockMovementsTable;

// A movement is a correction when it points back at the movement it fixes.
// Prefer the view's computed `isCorrection` flag; fall back to the raw link.
function isCorrectionRow(movement: StockMovement) {
  return (
    (movement as { isCorrection?: boolean }).isCorrection ??
    movement.correctionOfItemLedgerId != null
  );
}

// Signed quantity with a direction arrow (NUMERIC arrives as a string).
function QuantityDelta({ value }: { value: number | string | null }) {
  const n = value == null ? 0 : Number(value);
  if (!n) {
    return (
      <HStack spacing={1} className="font-medium text-muted-foreground">
        <LuMoveUp className="invisible text-lg" />
        <span className="tabular-nums">{n}</span>
      </HStack>
    );
  }
  return (
    <HStack spacing={1} className="font-medium">
      {n > 0 ? (
        <LuMoveUp className="text-success text-lg" />
      ) : (
        <LuMoveDown className="text-destructive text-lg" />
      )}
      <span className="tabular-nums">{Math.abs(n)}</span>
    </HStack>
  );
}

// Opens the item's side panel on the Activity tab inside the Inventory
// (Quantities) layout:
//   - `search`    filters the list behind it to this item (readableIdWithRevision)
//   - `location`  loads the location this entry lives in (the panel is location-scoped)
//   - `highlight` is the itemLedger row id, so the panel flashes this exact entry
function getInventoryItemActivityPath(movement: StockMovement) {
  const params = new URLSearchParams();
  if (movement.itemReadableId) params.set("search", movement.itemReadableId);
  if (movement.locationId) params.set("location", movement.locationId);
  params.set("highlight", movement.id ?? "");
  return `${path.to.inventoryItemActivity(movement.itemId ?? "")}?${params.toString()}`;
}
