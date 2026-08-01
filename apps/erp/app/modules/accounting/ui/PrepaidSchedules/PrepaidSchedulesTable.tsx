import { MenuIcon, MenuItem, Status } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCircleDollarSign,
  LuEye,
  LuHash,
  LuStar
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import { summarizePrepaidAmortization } from "../../accounting.utils";
import type { PrepaidScheduleListItem } from "../../types";

type PrepaidSchedulesTableProps = {
  data: PrepaidScheduleListItem[];
  count: number;
  primaryAction?: ReactNode;
};

const prepaidScheduleStatuses = ["Active", "Complete", "Cancelled"] as const;

const statusColor = (status: string) => {
  switch (status) {
    case "Active":
      return "green" as const;
    case "Complete":
      return "blue" as const;
    case "Cancelled":
      return "gray" as const;
    default:
      return "gray" as const;
  }
};

const PrepaidSchedulesTable = memo(
  ({ data, count, primaryAction }: PrepaidSchedulesTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const { company } = useUser();
    const currencyFormatter = useCurrencyFormatter({
      currency: company.baseCurrencyCode
    });

    const columns = useMemo<ColumnDef<PrepaidScheduleListItem>[]>(
      () => [
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <Hyperlink to={`${row.original.id}?${params.toString()}`}>
              {row.original.description}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "totalAmount",
          header: t`Total`,
          cell: ({ row }) =>
            currencyFormatter.format(Number(row.original.totalAmount ?? 0)),
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          id: "amortized",
          header: t`Amortized`,
          cell: ({ row }) => {
            const { amortized } = summarizePrepaidAmortization(
              row.original.prepaidScheduleEntry ?? [],
              row.original.totalAmount
            );
            return currencyFormatter.format(amortized);
          },
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          id: "remaining",
          header: t`Remaining`,
          cell: ({ row }) => {
            const { remaining } = summarizePrepaidAmortization(
              row.original.prepaidScheduleEntry ?? [],
              row.original.totalAmount
            );
            return currencyFormatter.format(remaining);
          },
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          accessorKey: "startDate",
          header: t`Start Date`,
          cell: ({ row }) =>
            row.original.startDate ? formatDate(row.original.startDate) : "—",
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "months",
          header: t`Months`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <Status color={statusColor(row.original.status)}>
              {row.original.status}
            </Status>
          ),
          meta: {
            filter: {
              type: "static",
              options: prepaidScheduleStatuses.map((v) => ({
                label: <Status color={statusColor(v)}>{v}</Status>,
                value: v
              }))
            },
            icon: <LuStar />
          }
        }
      ],
      [params, t, currencyFormatter]
    );

    const renderContextMenu = useCallback(
      (row: PrepaidScheduleListItem) => {
        return (
          <MenuItem
            disabled={!permissions.can("view", "accounting")}
            onClick={() => {
              navigate(
                `${path.to.prepaidSchedule(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuEye />} />
            <Trans>View</Trans>
          </MenuItem>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<PrepaidScheduleListItem>
        data={data}
        columns={columns}
        count={count}
        primaryAction={primaryAction}
        renderContextMenu={renderContextMenu}
        title={t`Prepaid Schedules`}
      />
    );
  }
);

PrepaidSchedulesTable.displayName = "PrepaidSchedulesTable";
export default PrepaidSchedulesTable;
