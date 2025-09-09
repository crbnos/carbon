import {
  Button,
  Checkbox,
  Combobox,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
} from "@carbon/react";
import { useNumberFormatter } from "@react-aria/i18n";
import { useFetcher } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuBox,
  LuCalculator,
  LuCheck,
  LuCircleCheck,
  LuCirclePlay,
  LuClock,
  LuExpand,
  LuGlassWater,
  LuLoaderCircle,
  LuMoveDown,
  LuMoveUp,
  LuPackage,
  LuPaintBucket,
  LuPuzzle,
  LuRuler,
  LuShapes,
  LuStar,
} from "react-icons/lu";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table,
  TrackingTypeIcon,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useUrlParams } from "~/hooks";
import {
  itemReorderingPolicies,
  itemReplenishmentSystems,
} from "~/modules/items";
import {
  ItemReorderPolicy,
  getReorderPolicyDescription,
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { itemTypes } from "../../inventory.models";
import type { InventoryItem } from "../../types";

type InventoryTableProps = {
  data: InventoryItem[];
  count: number;
  locationId: string;
  forms: ListItem[];
  substances: ListItem[];
};

const InventoryTable = memo(
  ({ data, count, locationId, forms, substances }: InventoryTableProps) => {
    const [params] = useUrlParams();

    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();

    const filters = useFilters();
    const materialSubstanceId = filters.getFilter("materialSubstanceId")?.[0];
    const materialFormId = filters.getFilter("materialFormId")?.[0];
    const numberFormatter = useNumberFormatter();

    const columns = useMemo<ColumnDef<InventoryItem>[]>(() => {
      return [
        {
          accessorKey: "readableIdWithRevision",
          header: "Item ID",
          cell: ({ row }) => (
            <HStack className="py-1">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                // @ts-ignore
                type={row.original.type}
              />

              <Hyperlink
                to={`${path.to.inventoryItem(row.original.id!)}/?${params}`}
              >
                <VStack spacing={0}>
                  {row.original.readableIdWithRevision}
                  <div className="w-full truncate text-muted-foreground text-xs">
                    {row.original.name}
                  </div>
                </VStack>
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },

        {
          accessorKey: "quantityOnHand",
          header: "On Hand",
          cell: ({ row }) =>
            row.original.itemTrackingType === "Non-Inventory" ? (
              <TrackingTypeIcon type="Non-Inventory" />
            ) : (
              numberFormatter.format(row.original.quantityOnHand)
            ),
          meta: {
            icon: <LuPackage />,
          },
        },

        {
          accessorKey: "daysRemaining",
          header: "Days",
          cell: ({ row }) => numberFormatter.format(row.original.daysRemaining),
          meta: {
            icon: <LuClock />,
          },
        },
        {
          accessorKey: "leadTime",
          header: "Lead Time",
          cell: ({ row }) => numberFormatter.format(row.original.leadTime),
          meta: {
            icon: <LuClock />,
          },
        },
        {
          accessorKey: "reorderingPolicy",
          header: "Reorder Policy",
          cell: ({ row }) => {
            return (
              <HStack>
                <Tooltip>
                  <TooltipTrigger>
                    <ItemReorderPolicy
                      reorderingPolicy={row.original.reorderingPolicy}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {getReorderPolicyDescription(row.original)}
                  </TooltipContent>
                </Tooltip>
              </HStack>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: itemReorderingPolicies.map((policy) => ({
                label: <ItemReorderPolicy reorderingPolicy={policy} />,
                value: policy,
              })),
            },
            icon: <LuCircleCheck />,
          },
        },
        {
          accessorKey: "replenishmentSystem",
          header: "Replenishment",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: itemReplenishmentSystems.map((type) => ({
                value: type,
                label: <Enumerable value={type} />,
              })),
            },
            icon: <LuLoaderCircle />,
          },
        },

        {
          accessorKey: "usageLast30Days",
          header: "Usage/Day (30d)",
          cell: ({ row }) =>
            numberFormatter.format(row.original.usageLast30Days),
          meta: {
            icon: <LuCalculator />,
          },
        },
        {
          accessorKey: "usageLast90Days",
          header: "Usage/Day (90d)",
          cell: ({ row }) =>
            numberFormatter.format(row.original.usageLast90Days),
          meta: {
            icon: <LuCalculator />,
          },
        },
        {
          accessorKey: "quantityOnPurchaseOrder",
          header: "On Purchase Order",
          cell: ({ row }) =>
            numberFormatter.format(row.original.quantityOnPurchaseOrder),
          meta: {
            icon: <LuMoveUp className="text-emerald-500" />,
          },
        },
        {
          accessorKey: "quantityOnProductionOrder",
          header: "On Jobs",
          cell: ({ row }) =>
            numberFormatter.format(row.original.quantityOnProductionOrder),
          meta: {
            icon: <LuMoveUp className="text-emerald-500" />,
          },
        },
        {
          accessorKey: "quantityOnProductionDemand",
          header: "On Jobs",
          cell: ({ row }) =>
            numberFormatter.format(row.original.quantityOnProductionDemand),
          meta: {
            icon: <LuMoveDown className="text-red-500" />,
          },
        },
        {
          accessorKey: "quantityOnSalesOrder",
          header: "On Sales Order",
          cell: ({ row }) =>
            numberFormatter.format(row.original.quantityOnSalesOrder),
          meta: {
            icon: <LuMoveDown className="text-red-500" />,
          },
        },
        {
          accessorKey: "unitOfMeasureCode",
          header: "Unit of Measure",
          cell: ({ row }) => {
            const unitOfMeasure = unitOfMeasures.find(
              (uom) => uom.value === row.original.unitOfMeasureCode
            );
            return (
              <Enumerable
                value={unitOfMeasure?.label ?? row.original.unitOfMeasureCode}
              />
            );
          },
          meta: {
            icon: <LuRuler />,
          },
        },
        {
          accessorKey: "materialFormId",
          header: "Shape",
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
          accessorKey: "finish",
          header: "Finish",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuPaintBucket />,
            filter: {
              type: "fetcher",
              endpoint: path.to.api.materialFinishes(materialSubstanceId),
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  value: name,
                  label: name,
                })) ?? [],
            },
          },
        },
        {
          accessorKey: "grade",
          header: "Grade",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuStar />,
            filter: {
              type: "fetcher",
              endpoint: path.to.api.materialGrades(materialSubstanceId),
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  value: name,
                  label: name,
                })) ?? [],
            },
          },
        },
        {
          accessorKey: "dimension",
          header: "Dimension",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuExpand />,
            filter: {
              type: "fetcher",
              endpoint: path.to.api.materialDimensions(materialFormId),
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  value: name,
                  label: name,
                })) ?? [],
            },
          },
        },
        {
          accessorKey: "materialType",
          header: "Type",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuPuzzle />,
            filter: {
              type: "fetcher",
              endpoint: path.to.api.materialTypes(
                materialSubstanceId,
                materialFormId
              ),
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ id, name }) => ({
                  value: id,
                  label: name,
                })) ?? [],
            },
          },
        },
        {
          accessorKey: "type",
          header: "Item Type",
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
    }, [
      forms,
      materialFormId,
      materialSubstanceId,
      numberFormatter,
      params,
      substances,
      unitOfMeasures,
    ]);

    const defaultColumnVisibility = {
      active: false,
      type: false,
      finish: false,
      grade: false,
      dimension: false,
      materialType: false,
    };

    const defaultColumnPinning = {
      left: ["readableIdWithRevision"],
    };

    const mrpFetcher = useFetcher<typeof mrpAction>();

    return (
      <Table<InventoryItem>
        count={count}
        columns={columns}
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={defaultColumnPinning}
        primaryAction={
          <div className="flex items-center gap-2">
            <Combobox
              asButton
              size="sm"
              value={locationId}
              options={locations}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(selected);
              }}
            />
            <mrpFetcher.Form method="post" action={path.to.api.mrp(locationId)}>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    type="submit"
                    variant="secondary"
                    rightIcon={<LuCirclePlay />}
                    isDisabled={mrpFetcher.state !== "idle"}
                    isLoading={mrpFetcher.state !== "idle"}
                  >
                    Recalculate
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  MRP runs automatically every 3 hours, but you can run it
                  manually here.
                </TooltipContent>
              </Tooltip>
            </mrpFetcher.Form>
          </div>
        }
        title="Inventory"
        table="inventory"
        withSavedView
      />
    );
  }
);

InventoryTable.displayName = "InventoryTable";

export default InventoryTable;

function getLocationPath(locationId: string) {
  return `${path.to.inventory}?location=${locationId}`;
}
