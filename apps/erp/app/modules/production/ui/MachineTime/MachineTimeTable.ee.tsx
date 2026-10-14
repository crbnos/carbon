// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  Button,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Status
} from "@carbon/react";
import { formatDateTimeInZone, formatPreciseDuration } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuActivity,
  LuCalendar,
  LuEye,
  LuFactory,
  LuHourglass,
  LuMapPin
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useUrlParams } from "~/hooks";
import { useCompanyTimeZone } from "~/hooks/useCompanyTimeZone";
import { path } from "~/utils/path";
import type { getUnattributedMachineTimes } from "../../production.service";

export type UnattributedMachineTime = NonNullable<
  Awaited<ReturnType<typeof getUnattributedMachineTimes>>["data"]
>[number];

/** The text of an instant on the work center's clock: the cell and the CSV. */
function formatMachineTimeInstant(
  value: string,
  timeZone: string,
  locale: string
) {
  return formatDateTimeInZone(value, timeZone, locale, { timeStyle: "short" });
}

/** An instant on the work center's clock (its location), else the company's. */
export function MachineTimeInstant({
  value,
  timeZone
}: {
  value: string;
  timeZone: string;
}) {
  const { locale } = useLocale();
  return (
    <DateTime value={value} locationTimeZone={timeZone} side="left">
      <span className="tabular-nums">
        {formatMachineTimeInstant(value, timeZone, locale)}
      </span>
    </DateTime>
  );
}

/** Machine time lengths in words, one style for the list and the drawer. */
export function useMachineTimeDuration() {
  const { locale } = useLocale();
  return useMemo(
    () => ({
      /** `endTime − startTime`, or null while the machine is running. */
      between: (startTime: string, endTime: string | null) =>
        endTime
          ? formatPreciseDuration(startTime, locale, Date.parse(endTime)).text
          : null,
      /** A length in milliseconds. */
      length: (ms: number) =>
        formatPreciseDuration("1970-01-01T00:00:00.000Z", locale, ms).text
    }),
    [locale]
  );
}

export function useMachineTimeZone() {
  const companyTimeZone = useCompanyTimeZone();
  return useCallback(
    // `||`: a location with no timezone of its own may store ''.
    (row: Pick<UnattributedMachineTime, "workCenter">) =>
      row.workCenter?.location?.timezone || companyTimeZone,
    [companyTimeZone]
  );
}

type MachineTimeTableProps = {
  data: UnattributedMachineTime[];
  count: number;
  workCenters: { id: string | null; name: string | null }[];
  locations: { id: string; name: string }[];
};

const MachineTimeTable = memo(
  ({ data, count, workCenters, locations }: MachineTimeTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();
    const { locale } = useLocale();
    const navigate = useNavigate();
    const duration = useMachineTimeDuration();
    const timeZoneOf = useMachineTimeZone();

    const columns = useMemo<ColumnDef<UnattributedMachineTime>[]>(
      () => [
        {
          accessorKey: "workCenterId",
          header: t`Work Center`,
          enableSorting: false,
          cell: ({ row }) => (
            <Hyperlink
              to={`${path.to.unattributedMachineTime(row.original.id)}?${params.toString()}`}
            >
              <Enumerable
                value={
                  row.original.workCenter?.name ?? row.original.workCenterId
                }
              />
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuFactory />,
            filter: {
              type: "static",
              options: workCenters.flatMap((workCenter) =>
                workCenter.id
                  ? [
                      {
                        value: workCenter.id,
                        label: <Enumerable value={workCenter.name} />
                      }
                    ]
                  : []
              )
            },
            exportValue: (row: UnattributedMachineTime) =>
              row.workCenter?.name ?? null
          }
        },
        {
          id: "locationId",
          header: t`Location`,
          enableSorting: false,
          cell: ({ row }) => (
            <Enumerable
              value={row.original.workCenter?.location?.name ?? null}
            />
          ),
          meta: {
            icon: <LuMapPin />,
            filter: {
              type: "static",
              options: locations.map((location) => ({
                value: location.id,
                label: <Enumerable value={location.name} />
              }))
            },
            exportValue: (row: UnattributedMachineTime) =>
              row.workCenter?.location?.name ?? null
          }
        },
        {
          accessorKey: "startTime",
          header: t`Start`,
          enableSorting: false,
          cell: ({ row }) => (
            <MachineTimeInstant
              value={row.original.startTime}
              timeZone={timeZoneOf(row.original)}
            />
          ),
          meta: {
            mobile: "P2",
            icon: <LuCalendar />,
            filter: { type: "dateRange" },
            exportValue: (row: UnattributedMachineTime) =>
              formatMachineTimeInstant(row.startTime, timeZoneOf(row), locale)
          }
        },
        {
          accessorKey: "endTime",
          header: t`End`,
          enableSorting: false,
          cell: ({ row }) =>
            row.original.endTime ? (
              <MachineTimeInstant
                value={row.original.endTime}
                timeZone={timeZoneOf(row.original)}
              />
            ) : null,
          meta: {
            icon: <LuCalendar />,
            filter: { type: "dateRange" },
            exportValue: (row: UnattributedMachineTime) =>
              row.endTime
                ? formatMachineTimeInstant(row.endTime, timeZoneOf(row), locale)
                : null
          }
        },
        {
          id: "duration",
          header: t`Duration`,
          enableSorting: false,
          cell: ({ row }) =>
            duration.between(row.original.startTime, row.original.endTime) ?? (
              <span className="text-muted-foreground">{t`Running`}</span>
            ),
          meta: {
            mobile: "P3",
            icon: <LuHourglass />,
            exportValue: (row: UnattributedMachineTime) =>
              duration.between(row.startTime, row.endTime) ?? t`Running`
          }
        },
        {
          id: "state",
          header: t`State`,
          enableSorting: false,
          cell: ({ row }) =>
            row.original.endTime ? (
              <Status color="green">{t`Stopped`}</Status>
            ) : (
              // Blue is in progress (a spinner); green is finished (a check).
              <Status color="blue">{t`Running`}</Status>
            ),
          meta: {
            icon: <LuActivity />,
            filter: {
              type: "static",
              isExclusive: true,
              options: [
                {
                  value: "Running",
                  label: <Status color="blue">{t`Running`}</Status>
                },
                {
                  value: "Stopped",
                  label: <Status color="green">{t`Stopped`}</Status>
                }
              ]
            },
            exportValue: (row: UnattributedMachineTime) =>
              row.endTime ? t`Stopped` : t`Running`
          }
        }
      ],
      [duration, locale, locations, params, t, timeZoneOf, workCenters]
    );

    const renderContextMenu = useCallback(
      (row: UnattributedMachineTime) => (
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.view}
          onClick={() => {
            navigate(
              `${path.to.unattributedMachineTime(row.id)}?${params.toString()}`
            );
          }}
        >
          <MenuIcon icon={<LuEye />} />
          {t`View Machine Time`}
        </MenuItem>
      ),
      [navigate, params, t]
    );

    // The drawer walks the queue in this list's order, so Review starts at
    // the top row. The queue holds stopped rows only: a running row cannot
    // be answered yet.
    const firstId = data.find((row) => row.endTime)?.id;

    return (
      <Table<UnattributedMachineTime>
        data={data}
        columns={columns}
        count={count}
        // The review queue walks one fixed order (newest start, then id), so
        // the list offers no sort.
        sort={null}
        renderContextMenu={renderContextMenu}
        title={t`Unattributed Time`}
        primaryAction={
          firstId ? (
            <Button
              onClick={() =>
                navigate(
                  `${path.to.unattributedMachineTime(firstId)}?${params.toString()}`
                )
              }
            >
              {t`Review`}
            </Button>
          ) : undefined
        }
      />
    );
  }
);

MachineTimeTable.displayName = "MachineTimeTable";
export default MachineTimeTable;
