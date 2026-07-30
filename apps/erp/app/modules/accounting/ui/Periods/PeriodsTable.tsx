import { MenuIcon, MenuItem, Status } from "@carbon/react";
import {
  formatDate,
  formatPeriodLabel,
  PERIOD_CLOSE_STATUS_COLOR_MAP
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuCalendarCheck,
  LuCircleCheck,
  LuLockKeyhole,
  LuToggleLeft,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { periodCloseStatuses } from "../../accounting.models";
import type { AccountingPeriodListItem, PeriodCloseStatus } from "../../types";

type PeriodsTableProps = {
  data: AccountingPeriodListItem[];
  count: number;
  primaryAction?: ReactNode;
};

const STATUS_COLOR = {
  Active: "green",
  Inactive: "red"
} as const;

const periodLabel = (period: AccountingPeriodListItem) =>
  formatPeriodLabel(period.startDate);

const PeriodsTable = memo(
  ({ data, count, primaryAction }: PeriodsTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<AccountingPeriodListItem>[]>(() => {
      const statusLabels: Record<AccountingPeriodListItem["status"], string> = {
        Active: t`Active`,
        Inactive: t`Inactive`
      };
      const closeStatusLabels: Record<PeriodCloseStatus, string> = {
        Open: t`Open`,
        Locked: t`Locked`,
        Closed: t`Closed`
      };

      return [
        {
          id: "period",
          header: t`Period`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.accountingPeriodClose(row.original.id)}>
              {periodLabel(row.original)}
            </Hyperlink>
          ),
          meta: {
            icon: <LuCalendarCheck />,
            exportValue: (row) => periodLabel(row)
          }
        },
        {
          accessorKey: "startDate",
          header: t`Start Date`,
          cell: ({ row }) => formatDate(row.original.startDate),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "endDate",
          header: t`End Date`,
          cell: ({ row }) => formatDate(row.original.endDate),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <Status color={STATUS_COLOR[row.original.status]}>
              {statusLabels[row.original.status]}
            </Status>
          ),
          meta: {
            filter: {
              type: "static",
              options: (["Active", "Inactive"] as const).map((v) => ({
                label: (
                  <Status color={STATUS_COLOR[v]}>{statusLabels[v]}</Status>
                ),
                value: v
              }))
            },
            icon: <LuToggleLeft />
          }
        },
        {
          accessorKey: "closeStatus",
          header: t`Close Status`,
          cell: ({ row }) => (
            <Status
              color={
                PERIOD_CLOSE_STATUS_COLOR_MAP[row.original.closeStatus] ??
                "gray"
              }
            >
              {closeStatusLabels[row.original.closeStatus]}
            </Status>
          ),
          meta: {
            filter: {
              type: "static",
              options: periodCloseStatuses.map((v) => ({
                label: (
                  <Status color={PERIOD_CLOSE_STATUS_COLOR_MAP[v] ?? "gray"}>
                    {closeStatusLabels[v]}
                  </Status>
                ),
                value: v
              }))
            },
            icon: <LuLockKeyhole />
          }
        }
      ];
    }, [t]);

    const renderContextMenu = useCallback(
      (row: AccountingPeriodListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("view", "accounting")}
            onClick={() => navigate(path.to.accountingPeriodClose(row.id))}
          >
            <MenuIcon icon={<LuCircleCheck />} />
            {row.closeStatus === "Closed" ? t`View Period` : t`Close Period`}
          </MenuItem>
          {row.closeStatus === "Open" &&
            permissions.can("delete", "accounting") && (
              <MenuItem
                destructive
                onClick={() => navigate(path.to.accountingPeriodDelete(row.id))}
              >
                <MenuIcon icon={<LuTrash />} />
                {t`Delete Period`}
              </MenuItem>
            )}
        </>
      ),
      [navigate, permissions, t]
    );

    return (
      <Table<AccountingPeriodListItem>
        data={data}
        columns={columns}
        count={count}
        primaryAction={primaryAction}
        renderContextMenu={renderContextMenu}
        title={t`Accounting Periods`}
      />
    );
  }
);

PeriodsTable.displayName = "PeriodsTable";
export default PeriodsTable;
