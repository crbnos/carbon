import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { formatTimeOfDay } from "@carbon/utils";
import {
  parseTime,
  toCalendarDateTime,
  today,
  toZoned
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendarDays,
  LuCalendarRange,
  LuClock,
  LuMapPin,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { ShiftLocation } from "~/modules/resources/types";
import { path } from "~/utils/path";
import type { Shift } from "../../types";

type ShiftsTableProps = {
  data: Shift[];
  count: number;
  locations: Partial<ShiftLocation>[];
};

const ShiftsTable = memo(({ data, count, locations }: ShiftsTableProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  const renderDays = useCallback((row: Shift) => {
    const days = [
      row.monday && "M",
      row.tuesday && "Tu",
      row.wednesday && "W",
      row.thursday && "Th",
      row.friday && "F",
      row.saturday && "Sa",
      row.sunday && "Su"
    ].filter(Boolean);

    return days.map((day) => (
      <Badge key={day as string} variant="outline" className="mr-0.5">
        {day}
      </Badge>
    ));
  }, []);

  const customColumns = useCustomColumns<Shift>("shift");

  const locationTimeZones = useMemo(
    () =>
      new Map(
        locations.flatMap((l) =>
          l.id && l.timezone ? [[l.id, l.timezone]] : []
        )
      ),
    [locations]
  );

  // A shift time is the location's wall clock ("08:00:00", no date, no zone).
  // Anchor it to today's occurrence at the location so the popover can show
  // what that moment is in the viewer's zone and UTC.
  const renderShiftTime = useCallback(
    (time: string | null, locationId: string | null) => {
      if (!time) return null;
      const tz = locationId ? locationTimeZones.get(locationId) : undefined;
      const inline = formatTimeOfDay(time, locale);
      if (!tz) return inline;
      const instant = toZoned(
        toCalendarDateTime(today(tz), parseTime(time)),
        tz
      ).toAbsoluteString();
      return (
        <DateTime
          value={instant}
          variant="time"
          locationTimeZone={tz}
          className="cursor-pointer underline decoration-muted-foreground/50 decoration-dotted underline-offset-[3px]"
        >
          {inline}
        </DateTime>
      );
    },
    [locale, locationTimeZones]
  );

  const columns = useMemo<ColumnDef<Shift>[]>(() => {
    const defaultColumns: ColumnDef<Shift>[] = [
      {
        accessorKey: "name",
        header: t`Shift`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id!}>{row.original.name}</Hyperlink>
        ),
        meta: {
          icon: <LuCalendarRange />
        }
      },
      {
        accessorKey: "startTime",
        header: t`Start Time`,
        cell: ({ row }) =>
          renderShiftTime(row.original.startTime, row.original.locationId),
        meta: {
          icon: <LuClock />
        }
      },
      {
        accessorKey: "endTime",
        header: t`End Time`,
        cell: ({ row }) =>
          renderShiftTime(row.original.endTime, row.original.locationId),
        meta: {
          icon: <LuClock />
        }
      },
      {
        accessorKey: "locationName",
        header: t`Location`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          icon: <LuMapPin />,
          filter: {
            type: "static",
            options: locations.map((location) => ({
              value: location.name!,
              label: <Enumerable value={location.name!} />
            }))
          }
        }
      },
      {
        id: "days",
        header: t`Days`,
        // @ts-ignore
        cell: ({ row }) => renderDays(row.original),
        meta: {
          icon: <LuCalendarDays />,
          filterHeader: t`Days`,
          exportValue: (row) =>
            (
              [
                ["monday", "M"],
                ["tuesday", "Tu"],
                ["wednesday", "W"],
                ["thursday", "Th"],
                ["friday", "F"],
                ["saturday", "Sa"],
                ["sunday", "Su"]
              ] as const
            )
              .filter(([key]) => row[key])
              .map(([, label]) => label)
              .join(", ")
        }
      }
    ];

    return [...defaultColumns, ...customColumns];
  }, [locations, renderDays, renderShiftTime, customColumns, t]);

  const renderContextMenu = useCallback(
    (row: Shift) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.shift(row.id!)}?${params.toString()}}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Shift</Trans>
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "people")}
            onClick={() => {
              navigate(`${path.to.deleteShift(row.id!)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Shift</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<Shift>
      data={data}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "people") && (
          <New label={t`Shift`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Shifts`}
    />
  );
});

ShiftsTable.displayName = "ShiftsTable";
export default ShiftsTable;
