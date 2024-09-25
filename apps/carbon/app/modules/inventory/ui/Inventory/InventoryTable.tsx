import { Checkbox, Combobox, HStack, Heading, VStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  New,
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
                thumbnailPath={row.original.thumbnailPath}
                type={row.original.type}
              />
              <Hyperlink
                to={`${path.to.inventoryItem(row.original.itemId!)}/?${params}`}
                className="max-w-[260px] truncate"
              >
                <>{row.original.readableId}</>
              </Hyperlink>
            </HStack>
          ),
        },

        {
          accessorKey: "name",
          header: "Short Desc",
          cell: ({ row }) => row.original.name,
        },
        {
          accessorKey: "locationName",
          header: "Location",
          cell: ({ row }) => <Enumerable value={row.original.locationName} />,
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
          },
        },
        {
          accessorKey: "quantityOnHand",
          header: "On Hand",
          cell: ({ row }) => row.original.quantityOnHand,
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
        {
          accessorKey: "unitOfMeasureCode",
          header: "Unit of Measure",
          cell: ({ row }) => {
            const unitOfMeasure = unitOfMeasures.find(
              (uom) => uom.code === row.original.unitOfMeasureCode
            );
            return unitOfMeasure
              ? unitOfMeasure.name
              : row.original.unitOfMeasureCode;
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
          },
        },
      ];
    }, [forms, params, substances, unitOfMeasures]);

    const actions = useMemo(() => {
      return [];
    }, []);

    const defaultColumnVisibility = {
      active: false,
      type: false,
    };

    return (
      <>
        {count === 0 && !hasFilters ? (
          <HStack className="w-full h-screen flex items-start justify-center">
            <VStack className="border rounded-md shadow-md w-96 mt-20">
              <div className="w-full flex flex-col gap-4 items-center justify-center py-8 bg-gradient-to-bl from-card to-background rounded-lg text-center group ring-4 ring-transparent hover:ring-white/10">
                <Heading size="h2">No Items Yet</Heading>
                <p className="text-muted-foreground text-base font-light">
                  Start by creating your first part
                </p>
                <New label="Part" to={path.to.newPart} />
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
