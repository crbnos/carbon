import { CardAction, Combobox, HStack, Heading, VStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useEffect, useMemo, useState } from "react";
import { LuImage } from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { usePermissions, useUrlParams } from "~/hooks";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { itemTypes } from "../../inventory.models";
import type { InventoryItem } from "../../types";
import InventoryItemIcon from "./InventoryItemIcon";
import { useInventoryItem } from "./useInventoryItem";

type InventoryTableProps = {
  data: InventoryItem[];
  count: number;
  locationId: string;
  locations: ListItem[];
};

const InventoryTable = memo(
  ({ data, count, locationId, locations }: InventoryTableProps) => {
    const permissions = usePermissions();
    const [params] = useUrlParams();
    const filter = params.get("q");
    const search = params.get("search");
    // put rows in state for use with optimistic ui updates
    const [rows, setRows] = useState<InventoryItem[]>(data);
    // we have to do this useEffect silliness since we're putitng rows
    // in state for optimistic ui updates
    useEffect(() => {
      setRows(data);
    }, [data]);

    const { view } = useInventoryItem();

    const { hasFilters } = useFilters();

    const [people] = usePeople();

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
            <>
              <HStack>
                {row.original.thumbnailPath ? (
                  <img
                    alt="P2392303"
                    className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent"
                    src={`/file/preview/private/${row.original.thumbnailPath}`}
                  />
                ) : (
                  <div className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
                    <LuImage className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                <Hyperlink
                  onClick={() => view(row.original)}
                  className="max-w-[260px] truncate"
                >
                  <>{row.original.readableId}</>
                </Hyperlink>
              </HStack>
            </>
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
                    <InventoryItemIcon type={type} />
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
          header: "Qty On Hand",
          cell: ({ row }) => row.original.quantityOnHand,
        },
        {
          accessorKey: "quantityAvailable",
          header: "Qty Available",
          cell: ({ row }) => row.original.quantityAvailable,
        },
        {
          accessorKey: "quantityOnPurchaseOrder",
          header: "Qty On Purchase Order",
          cell: ({ row }) => row.original.quantityOnPurchaseOrder,
        },
        {
          accessorKey: "quantityOnProdOrder",
          header: "Qty On Prod Order",
          cell: ({ row }) => row.original.quantityOnProdOrder,
        },
        {
          accessorKey: "quantityOnSalesOrder",
          header: "Qty On Sales Order",
          cell: ({ row }) => row.original.quantityOnSalesOrder,
        },
      ];
      // Don't put the revalidator in the deps array
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [people, view]);

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
        {count === 0 && !hasFilters && !search ? (
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
            <div className="flex justify-end">
              <CardAction>
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
              </CardAction>
            </div>

            <Table<InventoryItem>
              actions={actions}
              count={count}
              columns={columns}
              data={rows}
              defaultColumnVisibility={defaultColumnVisibility}
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
