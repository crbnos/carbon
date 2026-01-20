import { Combobox, HStack, VStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuBookMarked, LuBox, LuMapPin, LuPackage } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type BrowseShelf = {
  id: string;
  name: string;
  locationId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  itemCount: number;
  totalQuantity: number;
};

type BrowseShelvesTableProps = {
  data: BrowseShelf[];
  count: number;
  locationId: string;
};

const BrowseShelvesTable = memo(
  ({ data, count, locationId }: BrowseShelvesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const locations = useLocations();

    const columns = useMemo<ColumnDef<BrowseShelf>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: "Shelf",
          cell: ({ row }) => (
            <HStack className="py-1">
              <Hyperlink
                to={`${path.to.browseShelf(row.original.id!)}?${params}`}
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
          accessorKey: "locationId",
          header: "Location",
          cell: ({ row }) => {
            const location = locations.find(
              (l) => l.value === row.original.locationId
            );
            return (
              <Enumerable value={location?.label ?? row.original.locationId} />
            );
          },
          meta: {
            icon: <LuMapPin />
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
    }, [locations, params]);

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

    const handleRowClick = (row: BrowseShelf) => {
      navigate(`${path.to.browseShelf(row.id)}?${params.toString()}`);
    };

    return (
      <Table<BrowseShelf>
        count={count}
        columns={columns}
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={defaultColumnPinning}
        primaryAction={actions}
        onRowClick={handleRowClick}
        title="Shelves"
        table="shelf"
        withSavedView
      />
    );
  }
);

BrowseShelvesTable.displayName = "BrowseShelvesTable";

export default BrowseShelvesTable;

function getLocationPath(locationId: string) {
  return `${path.to.browseShelves}?location=${locationId}`;
}
