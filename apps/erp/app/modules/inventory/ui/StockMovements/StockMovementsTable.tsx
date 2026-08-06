import { Badge, HStack, MenuIcon, MenuItem, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuArrowRightLeft,
  LuBlocks,
  LuCalendar,
  LuFileText,
  LuHash,
  LuMapPin,
  LuMessageSquare,
  LuMoveDown,
  LuMoveUp,
  LuQrCode,
  LuUser,
  LuWarehouse,
  LuWrench
} from "react-icons/lu";
import { Link } from "react-router";
import {
  DateTime,
  EmployeeAvatar,
  exportOnlyColumn,
  Hyperlink,
  ItemThumbnail,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, useUser } from "~/hooks";
import { useDebouncedRealtime } from "~/hooks/useDebouncedRealtime";
import type { MethodItemType } from "~/modules/shared";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import {
  itemLedgerDocumentTypes,
  itemLedgerTypes
} from "../../inventory.models";
import type { StockMovement } from "../../types";
import StockMovementCorrectionModal from "./StockMovementCorrectionModal";

type StockMovementsTableProps = {
  data: StockMovement[];
  count: number;
};

const StockMovementsTable = memo(
  ({ data, count }: StockMovementsTableProps) => {
    const { t } = useLingui();
    const { company } = useUser();
    const permissions = usePermissions();
    const [correctionTarget, setCorrectionTarget] =
      useState<StockMovement | null>(null);
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
        exportOnlyColumn<StockMovement>({
          id: "itemName",
          header: t`Item Name`,
          value: (row) => row.itemDescription ?? null
        }),
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
          accessorKey: "comment",
          header: t`Comment`,
          cell: ({ row }) => (
            <span className="truncate text-muted-foreground">
              {row.original.comment ?? ""}
            </span>
          ),
          meta: {
            icon: <LuMessageSquare />
          }
        },
        {
          accessorKey: "postingDate",
          header: t`Posting Date`,
          cell: (item) => (
            <DateTime value={item.getValue<string>()} variant="date" />
          ),
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
          cell: (item) => (
            <DateTime value={item.getValue<string>()} variant="date" />
          ),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
    }, [people, locations, locationsById, t]);

    const renderContextMenu = useCallback(
      (row: StockMovement) => (
        <MenuItem
          disabled={!permissions.can("update", "inventory")}
          onClick={() => setCorrectionTarget(row)}
        >
          <MenuIcon icon={<LuWrench />} />
          {t`Correct Quantity`}
        </MenuItem>
      ),
      [permissions, t]
    );

    return (
      <>
        <Table<(typeof data)[number]>
          data={data}
          columns={columns}
          count={count}
          defaultColumnPinning={{
            left: ["itemReadableId"]
          }}
          renderContextMenu={renderContextMenu}
          title={t`Inventory Movements`}
          table="itemLedger"
          withSavedView
        />
        {correctionTarget && (
          <StockMovementCorrectionModal
            movement={correctionTarget}
            onClose={() => setCorrectionTarget(null)}
          />
        )}
      </>
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
