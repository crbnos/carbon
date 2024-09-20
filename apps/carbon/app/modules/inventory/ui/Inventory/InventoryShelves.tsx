import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import Grid from "~/components/Grid";
import type { ItemShelfQuantities } from "~/modules/items";
import type { ListItem } from "~/types";

type InventoryShelvesProps = {
  itemShelfQuantities: ItemShelfQuantities[];
  locations: ListItem[];
  shelves: ListItem[];
};

const InventoryShelves = ({
  itemShelfQuantities,
  locations,
  shelves,
}: InventoryShelvesProps) => {
  console.log({ shelves });
  const columns: ColumnDef<ItemShelfQuantities>[] = [
    {
      accessorKey: "locationId",
      header: "Location",
      cell: ({ row }) => {
        const locationId = row.original.locationId;
        const location = locations.find((loc) => loc.id === locationId);
        return location ? location.name : locationId;
      },
    },
    {
      accessorKey: "shelfId",
      header: "Shelf",
      cell: ({ row }) => {
        const shelfId = row.original.shelfId;
        const shelf = shelves.find((s) => s.id === shelfId);
        return shelf ? shelf.name : shelfId;
      },
    },
    {
      accessorKey: "quantityOnHand",
      header: "Quantity On Hand",
      cell: (item) => item.getValue(),
    },
  ];
  return (
    <>
      <Card className="w-full min-h-[50vh]">
        <CardHeader>
          <CardTitle>Shelves</CardTitle>
        </CardHeader>
        <CardContent>
          <Grid<ItemShelfQuantities>
            data={itemShelfQuantities}
            columns={columns}
            contained={false}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default InventoryShelves;
