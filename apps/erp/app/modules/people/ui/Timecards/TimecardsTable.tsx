import {
  Avatar,
  Badge,
  HStack,
  MenuIcon,
  MenuItem,
  useInterval
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuCalendar,
  LuClock,
  LuMapPin,
  LuPencil,
  LuRadar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useDateFormatter, usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type TimeCardEntry = {
  id: string | null;
  employeeId: string | null;
  avatarUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  clockIn: string | null;
  clockOut: string | null;
  shiftName: string | null;
  locationName: string | null;
  status: string | null;
  note: string | null;
};

type TimecardsTableProps = {
  data: TimeCardEntry[];
  count: number;
};

function formatTime(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(clockInStr: string, clockOutStr: string | null) {
  const end = clockOutStr ? new Date(clockOutStr).getTime() : Date.now();
  const ms = end - new Date(clockInStr).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

const TimecardsTable = memo(({ data, count }: TimecardsTableProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();
  const [params] = useUrlParams();
  const locations = useLocations();
  const [, setTick] = useState(0);

  // Re-render every minute to update duration for active timecards
  useInterval(() => setTick((t) => t + 1), 60000);

  const columns = useMemo<ColumnDef<TimeCardEntry>[]>(
    () => [
      {
        header: t`Employee`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.personTimecard(row.original.employeeId!)}>
            <HStack className="items-center gap-2">
              <Avatar
                className="size-6"
                src={row.original.avatarUrl ?? undefined}
                name={`${row.original.firstName ?? ""} ${row.original.lastName ?? ""}`}
              />
              <span className="text-sm">
                {row.original.firstName} {row.original.lastName}
              </span>
            </HStack>
          </Hyperlink>
        ),
        meta: {
          icon: <LuUser />
        }
      },
      {
        accessorKey: "clockIn",
        header: t`Date`,
        cell: ({ row }) =>
          row.original.clockIn
            ? formatDate(row.original.clockIn, { dateStyle: "medium" })
            : "—",
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "clockInTime",
        header: t`Clock In`,
        cell: ({ row }) =>
          row.original.clockIn ? formatTime(row.original.clockIn, locale) : "—",
        meta: {
          icon: <LuClock />
        }
      },
      {
        id: "clockOutTime",
        header: t`Clock Out`,
        cell: ({ row }) =>
          row.original.clockOut
            ? formatTime(row.original.clockOut, locale)
            : "—",
        meta: {
          icon: <LuClock />
        }
      },
      {
        id: "duration",
        header: t`Duration`,
        cell: ({ row }) => {
          if (!row.original.clockIn) return "—";
          return formatDuration(row.original.clockIn, row.original.clockOut);
        },
        meta: {
          icon: <LuClock />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "Active" ? "green" : "secondary"}
          >
            {row.original.status}
          </Badge>
        ),
        meta: {
          icon: <LuRadar />,
          filter: {
            type: "static" as const,
            options: [
              {
                value: "Active",
                label: <Badge variant="green">Active</Badge>
              },
              {
                value: "Complete",
                label: <Badge variant="secondary">Complete</Badge>
              }
            ],
            isArray: false
          }
        }
      },
      {
        accessorKey: "locationName",
        header: t`Location`,
        cell: ({ row }) => (
          <Enumerable value={row.original.locationName ?? null} />
        ),
        meta: {
          icon: <LuMapPin />,
          filter: {
            type: "static" as const,
            options: locations.map((location) => ({
              value: location.label,
              label: <Enumerable value={location.label} />
            })),
            isArray: false
          }
        }
      }
    ],
    [locations, t]
  );

  const renderContextMenu = useCallback(
    (row: TimeCardEntry) => {
      if (!row.id) return null;
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "people")}
            onClick={() =>
              navigate(`${path.to.timecard(row.id!)}?${params.toString()}`)
            }
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Timecard</Trans>
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "people")}
            onClick={() =>
              navigate(
                `${path.to.deleteTimecard(row.id!)}?${params.toString()}`
              )
            }
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Timecard</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<TimeCardEntry>
      data={data}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "people") && (
          <New label={t`Timecard`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      withSearch
      withPagination
      withSavedView
      title={t`Timecards`}
      table="timeCardEntry"
    />
  );
});

TimecardsTable.displayName = "TimecardsTable";
export default TimecardsTable;
