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
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import { useFetcher } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuBox,
  LuCheck,
  LuCirclePlay,
  LuPackage,
} from "react-icons/lu";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table,
} from "~/components";
import { useLocations } from "~/components/Form/Location";
import { useUrlParams } from "~/hooks";
import { itemTypes } from "~/modules/inventory/inventory.models";
import type { action as mrpAction } from "~/routes/api+/mrp";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";

type PlanningTableProps = {
  data: ProductionPlanningItem[];
  count: number;
  locationId: string;
  periods: { id: string; startDate: string }[];
};

type PeriodQuantity = {
  periodId: string;
  quantity: number;
};

const PlanningTable = memo(
  ({ data, count, locationId, periods }: PlanningTableProps) => {
    const [params] = useUrlParams();
    const dateFormatter = useDateFormatter({
      month: "short",
      day: "numeric",
    });

    console.log({ data });

    const numberFormatter = useNumberFormatter();

    const locations = useLocations();

    // Pre-calculate projections for each item
    const projectionsByItem = useMemo(() => {
      const projections = new Map<string, Map<string, number>>();

      data.forEach((item) => {
        const itemProjections = new Map<string, number>();

        // Convert arrays to maps for efficient lookups
        const demandActuals = new Map(
          ((item.demandActuals as PeriodQuantity[]) || []).map((d) => [
            d.periodId,
            d.quantity,
          ])
        );
        const supplyActuals = new Map(
          ((item.supplyActuals as PeriodQuantity[]) || []).map((s) => [
            s.periodId,
            s.quantity,
          ])
        );
        const demandForecasts = new Map(
          ((item.demandForecasts as PeriodQuantity[]) || []).map((d) => [
            d.periodId,
            d.quantity,
          ])
        );
        const supplyForecasts = new Map(
          ((item.supplyForecasts as PeriodQuantity[]) || []).map((s) => [
            s.periodId,
            s.quantity,
          ])
        );

        let runningProjection = item.quantityOnHand;

        periods.forEach((period) => {
          runningProjection +=
            (supplyActuals.get(period.id) || 0) +
            (supplyForecasts.get(period.id) || 0);
          runningProjection -=
            (demandActuals.get(period.id) || 0) +
            (demandForecasts.get(period.id) || 0);
          itemProjections.set(period.id, runningProjection);
        });

        projections.set(item.id!, itemProjections);
      });

      return projections;
    }, [data, periods]);

    const columns = useMemo<ColumnDef<ProductionPlanningItem>[]>(() => {
      const periodColumns: ColumnDef<ProductionPlanningItem>[] = periods.map(
        (period, index) => {
          const isCurrentWeek = index === 0;
          const header = isCurrentWeek
            ? "Present Week"
            : `Week of ${dateFormatter.format(
                parseDate(period.startDate).toDate(getLocalTimeZone())
              )}`;

          return {
            accessorKey: `period.${period.id}`,
            header,
            cell: ({ row }) => {
              const projection = projectionsByItem
                .get(row.original.id!)
                ?.get(period.id);
              return projection !== undefined
                ? numberFormatter.format(projection)
                : "-";
            },
          };
        }
      );

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
            numberFormatter.format(row.original.quantityOnHand),
          meta: {
            icon: <LuPackage />,
          },
        },
        ...periodColumns,
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
    }, [params, periods, dateFormatter, numberFormatter, projectionsByItem]);

    const defaultColumnVisibility = {
      active: false,
      type: false,
    };

    const defaultColumnPinning = {
      left: ["readableIdWithRevision"],
    };

    const mrpFetcher = useFetcher<typeof mrpAction>();

    return (
      <Table<ProductionPlanningItem>
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
            <mrpFetcher.Form method="post" action={path.to.api.mrp}>
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
        title="Planning"
        table="inventory"
        withSavedView
      />
    );
  }
);

PlanningTable.displayName = "PlanningTable";

export default PlanningTable;

function getLocationPath(locationId: string) {
  return `${path.to.inventory}?location=${locationId}`;
}
