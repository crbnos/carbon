import { Combobox, HStack, VStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuBookMarked, LuBox, LuPackage } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { useLocations } from "~/components/Form/Location";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type ShelfInventory = {
  id: string;
  name: string;
  locationId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  itemCount: number;
  totalQuantity: number;
};

type ShelfInventoryTableProps = {
  data: ShelfInventory[];
  count: number;
  locationId: string;
};

const ShelfInventoryTable = memo(
  ({ data, count, locationId }: ShelfInventoryTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const locations = useLocations();

    const columns = useMemo<ColumnDef<ShelfInventory>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: "Shelf",
          cell: ({ row }) => (
            <HStack className="py-1">
              <Hyperlink
                to={`${path.to.shelfInventory(row.original.id!)}?${params}`}
              >
                <VStack spacing={0}>{row.original.name}</VStack>
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "itemCount",
          header: "Items",
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.itemCount}</span>
          ),
          meta: {
            icon: <LuBox />
          }
        },
        {
          accessorKey: "totalQuantity",
          header: "Total Qty",
          cell: ({ row }) => (
            <span className="tabular-nums">
              {row.original.totalQuantity.toLocaleString()}
            </span>
          ),
          meta: {
            icon: <LuPackage />
          }
        }
      ];
    }, [params]);

    const defaultColumnVisibility = {};

    const defaultColumnPinning = {
      left: ["name"]
    };

    const actions = useMemo(() => {
      return (
        <Combobox
          asButton
          size="sm"
          value={locationId}
          options={locations}
          onChange={(selected) => {
            window.location.href = getLocationPath(selected);
          }}
        />
      );
    }, [locationId, locations]);

    const handleRowClick = (row: ShelfInventory) => {
      navigate(`${path.to.shelfInventory(row.id)}?${params.toString()}`);
    };

    return (
      <Table<ShelfInventory>
        count={count}
        columns={columns}
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={defaultColumnPinning}
        primaryAction={actions}
        onRowClick={handleRowClick}
        title="Shelves"
        table="shelfInventory"
        withSavedView
        searchPlaceholder="Search shelf or item..."
      />
    );
  }
);

ShelfInventoryTable.displayName = "ShelfInventoryTable";

export default ShelfInventoryTable;

function getLocationPath(locationId: string) {
  return `${path.to.shelfInventories}?location=${locationId}`;
}
