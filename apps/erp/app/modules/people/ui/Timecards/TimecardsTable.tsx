// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Avatar,
  Badge,
  HStack,
  MENU_ITEM_SHORTCUTS,
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
import { DateTime, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, useUrlParams } from "~/hooks";
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
  const [params] = useUrlParams();
  const locations = useLocations();
  const [, setTick] = useState(0);

  // Re-render every minute to update duration for active timecards
  useInterval(() => setTick((t) => t + 1), 60000);

  const columns = useMemo<ColumnDef<TimeCardEntry>[]>(() => {
    // Shared by the cell and the CSV export so the two never drift.
    const timeLabel = (value: string | null | undefined) =>
      value ? formatTime(value, locale) : "—";
    const durationLabel = (
      clockIn: string | null | undefined,
      clockOut: string | null | undefined
    ) => (clockIn ? formatDuration(clockIn, clockOut ?? null) : "—");

    return [
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
          mobile: "P1",
          icon: <LuUser />
        }
      },
      {
        accessorKey: "clockIn",
        header: t`Date`,
        cell: ({ row }) =>
          row.original.clockIn ? (
            <DateTime
              value={row.original.clockIn}
              variant="date"
              dateOptions={{ dateStyle: "medium" }}
            />
          ) : (
            "—"
          ),
        meta: {
          mobile: "P3",
          // Phones: line 2 also carries the clock-in – clock-out span.
          mobileCell: ({ row }) =>
            row.original.clockIn ? (
              <>
                <DateTime
                  value={row.original.clockIn}
                  variant="date"
                  dateOptions={{ dateStyle: "medium" }}
                />
                {" · "}
                <DateTime value={row.original.clockIn} variant="time" />
                {" – "}
                <DateTime
                  value={row.original.clockOut}
                  variant="time"
                  fallback="—"
                />
              </>
            ) : (
              "—"
            ),
          icon: <LuCalendar />
        }
      },
      {
        id: "clockInTime",
        header: t`Clock In`,
        cell: ({ row }) => (
          <DateTime value={row.original.clockIn} variant="time" fallback="—" />
        ),
        meta: {
          icon: <LuClock />,
          exportValue: (row) => timeLabel(row.clockIn)
        }
      },
      {
        id: "clockOutTime",
        header: t`Clock Out`,
        cell: ({ row }) => (
          <DateTime value={row.original.clockOut} variant="time" fallback="—" />
        ),
        meta: {
          icon: <LuClock />,
          exportValue: (row) => timeLabel(row.clockOut)
        }
      },
      {
        id: "duration",
        header: t`Duration`,
        cell: ({ row }) =>
          durationLabel(row.original.clockIn, row.original.clockOut),
        meta: {
          mobile: "P2",
          icon: <LuClock />,
          exportValue: (row) => durationLabel(row.clockIn, row.clockOut)
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
          mobile: "P2",
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
    ];
  }, [locations, t, locale]);

  const renderContextMenu = useCallback(
    (row: TimeCardEntry) => {
      if (!row.id) return null;
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            disabled={!permissions.can("update", "people")}
            onClick={() =>
              navigate(`${path.to.timecard(row.id!)}?${params.toString()}`)
            }
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Timecard</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
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
