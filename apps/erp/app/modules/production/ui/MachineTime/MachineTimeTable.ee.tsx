// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem, Status } from "@carbon/react";
import { formatDateTimeInZone, formatPreciseDuration } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuEye,
  LuFactory,
  LuHourglass,
  LuLoaderCircle
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink, Table } from "~/components";
import { useUrlParams } from "~/hooks";
import { useCompanyTimeZone } from "~/hooks/useCompanyTimeZone";
import { path } from "~/utils/path";
import { unattributedMachineTimeStatuses } from "../../production.models";
import type { getUnattributedMachineTimes } from "../../production.service";

export type UnattributedMachineTime = NonNullable<
  Awaited<ReturnType<typeof getUnattributedMachineTimes>>["data"]
>[number];

type UnattributedMachineTimeStatus =
  Database["public"]["Enums"]["unattributedMachineTimeStatus"];

const STATUS_COLOR = {
  Open: "orange",
  Assigned: "green",
  Dismissed: "gray"
} as const satisfies Record<UnattributedMachineTimeStatus, string>;

export function MachineTimeStatus({
  status
}: {
  status: UnattributedMachineTimeStatus | null;
}) {
  const { t } = useLingui();
  if (!status) return null;
  const label: Record<UnattributedMachineTimeStatus, string> = {
    Open: t`Open`,
    Assigned: t`Assigned`,
    Dismissed: t`Dismissed`
  };
  return <Status color={STATUS_COLOR[status]}>{label[status]}</Status>;
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
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <MachineTimeStatus status={row.original.status} />,
        meta: {
          mobile: "P2",
          filter: {
            type: "static",
            options: unattributedMachineTimeStatuses.map((status) => ({
              value: status,
              label: <MachineTimeStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuLoaderCircle />
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

  return (
    <Table<UnattributedMachineTime>
      data={data}
      columns={columns}
      count={count}
      renderContextMenu={renderContextMenu}
      title={t`Unattributed Machine Time`}
    />
  );
});

MachineTimeTable.displayName = "MachineTimeTable";
export default MachineTimeTable;
