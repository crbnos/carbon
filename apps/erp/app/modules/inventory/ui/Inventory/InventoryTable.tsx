import { Button, Checkbox, Combobox, HStack, VStack } from "@carbon/react";
import { Link } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuBox,
  LuCheck,
  LuCirclePlus,
  LuFactory,
  LuGlassWater,
  LuMapPin,
  LuPackage,
  LuRuler,
  LuShapes,
  LuShoppingBag,
  LuShoppingCart,
  LuTriangleAlert,
} from "react-icons/lu";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useUrlParams } from "~/hooks";
import type { UnitOfMeasureListItem } from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { itemTypes } from "../../inventory.models";
import type { InventoryItem } from "../../types";

type InventoryTableProps = {
  data: InventoryItem[];
  count: number;
  locationId: string;
  locations: ListItem[];
  forms: ListItem[];
  substances: ListItem[];
  unitOfMeasures: UnitOfMeasureListItem[];
};

const InventoryTable = memo(
  ({
    data,
    count,
    locationId,
    locations,
    unitOfMeasures,
    forms,
    substances,
  }: InventoryTableProps) => {
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
            <HStack className="py-1">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                // @ts-ignore
                type={row.original.type}
              />

              <VStack spacing={0}>
                <Hyperlink
                  to={`${path.to.inventoryItem(
                    row.original.itemId!
                  )}/?${params}`}
                >
                  {row.original.readableId}
                </Hyperlink>
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.name}
                </div>
              </VStack>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          accessorKey: "locationName",
          header: "Location",
          cell: ({ row }) => <Enumerable value={row.original.locationName} />,
          meta: {
            icon: <LuMapPin />,
          },
        },

        {
          accessorKey: "materialFormId",
          header: "Form",
          cell: ({ row }) => {
            const form = forms.find(
              (f) => f.id === row.original.materialFormId
            );
            return <Enumerable value={form?.name ?? null} />;
          },
          meta: {
            filter: {
              type: "static",
              options: forms.map((form) => ({
                label: <Enumerable value={form.name} />,
                value: form.id,
              })),
            },
            icon: <LuShapes />,
          },
        },
        {
          accessorKey: "materialSubstanceId",
          header: "Substance",
          cell: ({ row }) => {
            const substance = substances.find(
              (s) => s.id === row.original.materialSubstanceId
            );
            return <Enumerable value={substance?.name ?? null} />;
          },
          meta: {
            filter: {
              type: "static",
              options: substances.map((substance) => ({
                label: <Enumerable value={substance.name ?? null} />,
                value: substance.id,
              })),
            },
            icon: <LuGlassWater />,
          },
        },
        {
          accessorKey: "quantityOnHand",
          header: "On Hand",
          cell: ({ row }) => row.original.quantityOnHand,
          meta: {
            icon: <LuPackage />,
          },
        },

        {
          accessorKey: "quantityOnPurchaseOrder",
          header: "On Purchase Order",
          cell: ({ row }) => row.original.quantityOnPurchaseOrder,
          meta: {
            icon: <LuShoppingCart />,
          },
        },
        {
          accessorKey: "quantityOnProdOrder",
          header: "On Prod Order",
          cell: ({ row }) => row.original.quantityOnProdOrder,
          meta: {
            icon: <LuFactory />,
          },
        },
        {
          accessorKey: "quantityOnSalesOrder",
          header: "On Sales Order",
          cell: ({ row }) => row.original.quantityOnSalesOrder,
          meta: {
            icon: <LuShoppingBag />,
          },
        },
        {
          accessorKey: "unitOfMeasureCode",
          header: "Unit of Measure",
          cell: ({ row }) => {
            const unitOfMeasure = unitOfMeasures.find(
              (uom) => uom.code === row.original.unitOfMeasureCode
            );
            return (
              <Enumerable
                value={unitOfMeasure?.name ?? row.original.unitOfMeasureCode}
              />
            );
          },
          meta: {
            icon: <LuRuler />,
          },
        },
        {
          accessorKey: "type",
          header: "Type",
          cell: ({ row }) =>
            row.original.type && (
              <HStack>
                <MethodItemTypeIcon type={row.original.type} />
                <span>{row.original.type}</span>
              </HStack>
            ),
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
            icon: <LuBox />,
          },
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ],
            },
            pluralHeader: "Active Statuses",
            icon: <LuCheck />,
          },
        },
      ];
    }, [forms, params, substances, unitOfMeasures]);

    const defaultColumnVisibility = {
      active: false,
      type: false,
    };

    const defaultColumnPinning = {
      left: ["readableId"],
    };

    return (
      <>
        {count === 0 && !hasFilters ? (
          <div className="flex flex-col w-full h-full items-center justify-center gap-4">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
              <LuTriangleAlert className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono font-light text-foreground uppercase">
              No inventory items exists
            </span>
            <Button leftIcon={<LuCirclePlus />} asChild>
              <Link to={path.to.newPart}>New Part</Link>
            </Button>
          </div>
        ) : (
          <>
            <Table<InventoryItem>
              count={count}
              columns={columns}
              data={data}
              defaultColumnVisibility={defaultColumnVisibility}
              defaultColumnPinning={defaultColumnPinning}
              primaryAction={
                <Combobox
                  asButton
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
              title="Inventory"
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
