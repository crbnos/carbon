import { Combobox, HStack, Heading, VStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useUrlParams } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { itemTypes } from "../../inventory.models";
import type { InventoryItem } from "../../types";

type InventoryTableProps = {
  data: InventoryItem[];
  count: number;
  locationId: string;
  locations: ListItem[];
};

const InventoryTable = memo(
  ({ data, count, locationId, locations }: InventoryTableProps) => {
    const { hasFilters } = useFilters();
    const [params] = useUrlParams();

    const locationOptions = locations.map((location) => ({
      label: location.name,
      value: location.id,
    }));

    const columns = useMemo<ColumnDef<InventoryItem>[]>(() => {
      return [
        {
          accessorKey: "readableId",
          header: "Item ID",
          cell: ({ row }) => (
            <div className="py-1">
              <HStack>
                <ItemThumbnail thumbnailPath={row.original.thumbnailPath} />
                <Hyperlink
                  to={`${path.to.inventoryItem(
                    row.original.itemId!
                  )}/?${params}`}
                  className="max-w-[260px] truncate"
                >
                  <>{row.original.readableId}</>
                </Hyperlink>
              </HStack>
            </div>
          ),
        },
        {
          accessorKey: "type",
          header: "Type",
          cell: ({ row }) => row.original.type,
          meta: {
            filter: {
              type: "static",
              options: itemTypes.map((type) => ({
                label: (
                  <HStack spacing={2}>
                    <MethodItemTypeIcon type={type} />
                    <span>{type}</span>
                  </HStack>
                ),
                value: type,
              })),
            },
          },
        },
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => row.original.name,
        },
        {
          accessorKey: "locationName",
          header: "Location",
          cell: ({ row }) => <Enumerable value={row.original.locationName} />,
        },
        {
          accessorKey: "quantityOnHand",
          header: "On Hand",
          cell: ({ row }) => row.original.quantityOnHand,
        },
        {
          accessorKey: "quantityAvailable",
          header: "Available",
          cell: ({ row }) => row.original.quantityAvailable,
        },
        {
          accessorKey: "quantityOnPurchaseOrder",
          header: "On Purchase Order",
          cell: ({ row }) => row.original.quantityOnPurchaseOrder,
        },
        {
          accessorKey: "quantityOnProdOrder",
          header: "On Prod Order",
          cell: ({ row }) => row.original.quantityOnProdOrder,
        },
        {
          accessorKey: "quantityOnSalesOrder",
          header: "On Sales Order",
          cell: ({ row }) => row.original.quantityOnSalesOrder,
        },
      ];
    }, [params]);

    const actions = useMemo(() => {
      return [];
    }, []);

    const defaultColumnVisibility = {
      readableId: true,
      type: true,
      name: true,
      description: true,
    };

    return (
      <>
        {count === 0 && !hasFilters ? (
          <HStack className="w-full h-screen flex items-start justify-center">
            <VStack className="border rounded-md shadow-md w-96 mt-20">
              <div className="w-full flex flex-col gap-4 items-center justify-center py-8 bg-gradient-to-bl from-card to-background rounded-lg text-center group ring-4 ring-transparent hover:ring-white/10">
                <Heading size="h2">No Items Yet</Heading>
                <p className="text-muted-foreground text-base font-light">
                  Start by creating your first item
                </p>
              </div>
            </VStack>
          </HStack>
        ) : (
          <>
            <Table<InventoryItem>
              actions={actions}
              count={count}
              columns={columns}
              data={data}
              defaultColumnVisibility={defaultColumnVisibility}
              primaryAction={
                <Combobox
                  size="sm"
                  value={locationId}
                  options={locationOptions}
                  onChange={(selected) => {
                    // hard refresh because initialValues update has no effect otherwise
                    window.location.href = getLocationPath(selected);
                  }}
                  className="w-64"
                />
              }
            />
          </>
        )}
      </>
    );
  }
);

InventoryTable.displayName = "InventoryTable";

export default InventoryTable;

function getLocationPath(locationId: string) {
  return `${path.to.inventory}?location=${locationId}`;
}
