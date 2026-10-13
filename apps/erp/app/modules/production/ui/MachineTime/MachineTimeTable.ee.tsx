// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Button, MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { formatDateTimeInZone, formatPreciseDuration } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuCalendar, LuEye, LuFactory, LuHourglass } from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink, Table } from "~/components";
import { useUrlParams } from "~/hooks";
import { useCompanyTimeZone } from "~/hooks/useCompanyTimeZone";
import { path } from "~/utils/path";
import type { getUnattributedMachineTimes } from "../../production.service";

export type UnattributedMachineTime = NonNullable<
  Awaited<ReturnType<typeof getUnattributedMachineTimes>>["data"]
>[number];

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
        {formatDateTimeInZone(value, timeZone, locale)}
      </span>
    </DateTime>
  );
}

/** `endTime − startTime` in words, or null while the machine is running. */
export function useMachineTimeDuration() {
  const { locale } = useLocale();
  return useCallback(
    (startTime: string, endTime: string | null) =>
      endTime
        ? formatPreciseDuration(startTime, locale, Date.parse(endTime)).text
        : null,
    [locale]
  );
}

export function useMachineTimeZone() {
  const companyTimeZone = useCompanyTimeZone();
  return useCallback(
    (row: Pick<UnattributedMachineTime, "workCenter">) =>
      row.workCenter?.location?.timezone ?? companyTimeZone,
    [companyTimeZone]
  );
}

type MachineTimeTableProps = {
  data: UnattributedMachineTime[];
  count: number;
};

const MachineTimeTable = memo(({ data, count }: MachineTimeTableProps) => {
  const [params] = useUrlParams();
  const { t } = useLingui();
  const navigate = useNavigate();
  const duration = useMachineTimeDuration();
  const timeZoneOf = useMachineTimeZone();

  const columns = useMemo<ColumnDef<UnattributedMachineTime>[]>(
    () => [
      {
        id: "workCenter",
        header: t`Work Center`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>
            {row.original.workCenter?.name ?? row.original.workCenterId}
          </Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuFactory />,
          exportValue: (row: UnattributedMachineTime) =>
            row.workCenter?.name ?? null
        }
      },
      {
        accessorKey: "startTime",
        header: t`Start`,
        cell: ({ row }) => (
          <MachineTimeInstant
            value={row.original.startTime}
            timeZone={timeZoneOf(row.original)}
          />
        ),
        meta: {
          mobile: "P2",
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "endTime",
        header: t`End`,
        cell: ({ row }) =>
          row.original.endTime ? (
            <MachineTimeInstant
              value={row.original.endTime}
              timeZone={timeZoneOf(row.original)}
            />
          ) : null,
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "duration",
        header: t`Duration`,
        cell: ({ row }) =>
          duration(row.original.startTime, row.original.endTime) ?? (
            <span className="text-muted-foreground">{t`Running`}</span>
          ),
        meta: {
          mobile: "P3",
          icon: <LuHourglass />
        }
      }
    ],
    [duration, t, timeZoneOf]
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
  // the top row.
  const firstId = data[0]?.id;

  return (
    <Table<UnattributedMachineTime>
      data={data}
      columns={columns}
      count={count}
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
});

MachineTimeTable.displayName = "MachineTimeTable";
export default MachineTimeTable;
