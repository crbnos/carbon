import { HStack, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuArrowRightLeft,
  LuCalendar,
  LuFileText,
  LuHash,
  LuMapPin,
  LuMoveDown,
  LuMoveUp,
  LuPackage,
  LuQrCode,
  LuUser,
  LuWarehouse
} from "react-icons/lu";
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
            icon: <LuPackage />
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
          accessorKey: "quantity",
          header: t`Quantity`,
          cell: ({ row }) => {
            const value = row.original.quantity;
            if (!value)
              return (
                <HStack
                  spacing={1}
                  className="font-medium text-muted-foreground"
                >
                  <LuMoveUp className="invisible text-lg" />
                  <span>{value}</span>
                </HStack>
              );
            const isPositive = value > 0;
            return (
              <HStack spacing={1} className="font-medium">
                {isPositive ? (
                  <LuMoveUp className="text-success text-lg" />
                ) : (
                  <LuMoveDown className="text-destructive text-lg" />
                )}
                <span>{Math.abs(value)}</span>
              </HStack>
            );
          },
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
          cell: ({ row }) =>
            row.original.trackedEntityReadableId ||
            row.original.trackedEntityId,
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

    return (
      <Table<(typeof data)[number]>
        data={data}
        columns={columns}
        count={count}
        defaultColumnPinning={{
          left: ["itemReadableId"]
        }}
        title={t`Stock Movements`}
        table="itemLedger"
        withSavedView
      />
    );
  }
);

StockMovementsTable.displayName = "StockMovementsTable";
export default StockMovementsTable;

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
