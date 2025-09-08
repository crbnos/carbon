import {
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  VStack,
} from "@carbon/react";
import { useUrlParams } from "@carbon/remix";
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuEllipsisVertical,
  LuPencil,
  LuTrash2,
} from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";

import { Link } from "@remix-run/react";
import { useLocations } from "~/components/Form/Location";
import ItemThumbnail from "~/components/ItemThumbnail";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { ProductionProjection } from "../../types";

type ProductionProjectionsTableProps = {
  data: ProductionProjection[];
  count: number;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
};

const defaultColumnPinning = {
  left: ["readableIdWithRevision"],
  right: ["actions"],
};

const ProductionProjectionsTable = memo(
  ({ data, count, locationId, periods }: ProductionProjectionsTableProps) => {
    const numberFormatter = useNumberFormatter();
    const dateFormatter = useDateFormatter({
      month: "short",
      day: "numeric",
    });
    const [params] = useUrlParams();
    const permissions = usePermissions();
    const locations = useLocations();
    const [selectedItem, setSelectedItem] =
      useState<ProductionProjection | null>(null);

    const columns = useMemo<ColumnDef<ProductionProjection>[]>(() => {
      const periodColumns: ColumnDef<ProductionProjection>[] = periods.map(
        (period, index) => {
          const isCurrentWeek = index === 0;
          const weekNumber = index + 1;
          const weekKey = `week${weekNumber}` as keyof ProductionProjection;
          const startDate = parseDate(period.startDate).toDate(
            getLocalTimeZone()
          );
          const endDate = parseDate(period.endDate).toDate(getLocalTimeZone());

          return {
            accessorKey: weekKey,
            header: () => (
              <VStack spacing={0}>
                <div>
                  {isCurrentWeek ? "Present Week" : `Week ${weekNumber}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {dateFormatter.format(startDate)} -{" "}
                  {dateFormatter.format(endDate)}
                </div>
              </VStack>
            ),
            cell: ({ row }) => {
              const value = row.getValue<number>(weekKey);
              if (value === undefined || value === null || value === 0)
                return "-";
              return <span>{numberFormatter.format(value)}</span>;
            },
          };
        }
      );

      return [
        {
          accessorKey: "readableIdWithRevision",
          header: "Part ID",
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.productionProjection(row.original.id!, locationId)}
            >
              <HStack className="py-1 cursor-pointer">
                <ItemThumbnail
                  size="sm"
                  thumbnailPath={row.original.thumbnailPath}
                  // @ts-ignore
                  type={row.original.type}
                />

                <VStack spacing={0} className="font-medium">
                  {row.original.readableIdWithRevision}
                  <div className="w-full truncate text-muted-foreground text-xs">
                    {row.original.name}
                  </div>
                </VStack>
              </HStack>
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        ...periodColumns,
        {
          id: "actions",
          header: "",
          cell: ({ row }) => {
            const canDelete = permissions.can("delete", "production");
            if (!canDelete) return null;

            return (
              <div className="flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Actions"
                      variant="secondary"
                      icon={<LuEllipsisVertical />}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link
                        to={path.to.productionProjection(
                          row.original.id!,
                          locationId
                        )}
                      >
                        <DropdownMenuIcon icon={<LuPencil />} />
                        Edit
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setSelectedItem(row.original)}
                      destructive
                    >
                      <DropdownMenuIcon icon={<LuTrash2 />} />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          },
        },
      ];
    }, [periods, dateFormatter, numberFormatter, locationId, permissions]);

    return (
      <>
        <Table<ProductionProjection>
          data={data}
          columns={columns}
          count={count}
          defaultColumnPinning={defaultColumnPinning}
          title="Projections"
          table="production-planning"
          withSavedView
          withSelectableRows
          withSimpleSorting
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
              {permissions.can("create", "production") && (
                <New label="Part" to={`new?${params.toString()}`} />
              )}
            </div>
          }
        />

        {selectedItem && (
          <ConfirmDelete
            action={path.to.deleteProductionProjections(
              selectedItem.id!,
              locationId
            )}
            name={`${selectedItem.readableIdWithRevision} forecasts`}
            text={`Are you sure you want to delete all forecasts for ${selectedItem.readableIdWithRevision}? This action cannot be undone.`}
            onCancel={() => setSelectedItem(null)}
            onSubmit={() => setSelectedItem(null)}
          />
        )}
      </>
    );
  }
);

ProductionProjectionsTable.displayName = "ProductionProjectionsTable";
export default ProductionProjectionsTable;

function getLocationPath(locationId: string) {
  return `${path.to.productionProjections}?location=${locationId}`;
}
