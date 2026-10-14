// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  useUrlParams,
  useViewport,
  VStack
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuEllipsisVertical,
  LuPencil,
  LuTrash2
} from "react-icons/lu";
import { Link } from "react-router";
import { exportOnlyColumn, Hyperlink, New, Table } from "~/components";
import { useLocations } from "~/components/Form/Location";
import ItemThumbnail from "~/components/ItemThumbnail";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { DemandProjection } from "../../types";

type DemandProjectionsTableProps = {
  data: DemandProjection[];
  count: number;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
};

const defaultColumnPinning = {
  left: ["readableIdWithRevision"],
  right: ["actions"]
};

const DemandProjectionsTable = memo(
  ({ data, count, locationId, periods }: DemandProjectionsTableProps) => {
    const numberFormatter = useNumberFormatter();
    const dateFormatter = useDateFormatter({
      month: "short",
      day: "numeric"
    });
    const [params] = useUrlParams();
    const { t } = useLingui();
    const { isPhone } = useViewport();
    const permissions = usePermissions();
    const locations = useLocations();
    const [selectedItem, setSelectedItem] = useState<DemandProjection | null>(
      null
    );

    const columns = useMemo<ColumnDef<DemandProjection>[]>(() => {
      const periodColumns: ColumnDef<DemandProjection>[] = periods.map(
        (period, index) => {
          const isCurrentWeek = index === 0;
          const weekNumber = index + 1;
          const weekKey = `week${weekNumber}` as keyof DemandProjection;
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
            meta: {
              filterHeader: isCurrentWeek
                ? t`Present Week`
                : t`Week ${weekNumber}`,
              exportValue: (row: DemandProjection) => {
                const value = row[weekKey] as number | undefined | null;
                return value === undefined || value === null || value === 0
                  ? null
                  : value;
              }
            }
          };
        }
      );

      return [
        {
          accessorKey: "readableIdWithRevision",
          header: t`Part ID`,
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.demandProjection(row.original.id!, locationId)}
            >
              <HStack className="py-1 cursor-pointer max-md:min-w-0">
                <ItemThumbnail
                  size="sm"
                  thumbnailPath={row.original.thumbnailPath}
                  // @ts-expect-error
                  type={row.original.type}
                />

                <VStack spacing={0} className="font-medium max-md:min-w-0">
                  <span className="max-md:block max-md:w-full max-md:truncate">
                    {row.original.readableIdWithRevision}
                  </span>
                  {distinctItemText(
                    row.original.readableIdWithRevision,
                    row.original.name
                  ) && (
                    <div className="w-full truncate text-muted-foreground text-xs">
                      {row.original.name}
                    </div>
                  )}
                </VStack>
              </HStack>
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookMarked />
          }
        },
        exportOnlyColumn<DemandProjection>({
          id: "itemName",
          header: t`Item Name`,
          value: (row) => row.name ?? null
        }),
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
                      aria-label={t`Actions`}
                      variant="secondary"
                      icon={<LuEllipsisVertical />}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      shortcut={MENU_ITEM_SHORTCUTS.edit}
                      asChild
                    >
                      <Link
                        to={path.to.demandProjection(
                          row.original.id!,
                          locationId
                        )}
                      >
                        <DropdownMenuIcon icon={<LuPencil />} />
                        Edit
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      shortcut={MENU_ITEM_SHORTCUTS.delete}
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
          }
        }
      ];
    }, [periods, dateFormatter, numberFormatter, locationId, permissions, t]);

    return (
      <>
        <Table<DemandProjection>
          mobileLayout="table"
          data={data}
          columns={columns}
          count={count}
          defaultColumnPinning={defaultColumnPinning}
          title={t`Demand Forecasts`}
          table="demand-projection"
          withSavedView
          withSelectableRows={!isPhone}
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
                <New label={t`Part`} to={`new?${params.toString()}`} />
              )}
            </div>
          }
        />

        {selectedItem && (
          <ConfirmDelete
            action={path.to.deleteDemandProjections(
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

DemandProjectionsTable.displayName = "DemandProjectionsTable";
export default DemandProjectionsTable;

function getLocationPath(locationId: string) {
  return `${path.to.demandProjections}?location=${locationId}`;
}
