// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuCalendarCheck,
  LuClock,
  LuCoins,
  LuUpload,
  LuUser
} from "react-icons/lu";
import { DateTime, EmployeeAvatar, Table } from "~/components";
import {
  useCurrencyFormatter,
  useDateFormatter,
  useQuantityFormatter
} from "~/hooks";

export type PayrollPeriodTotal = {
  id: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  grossWages: number;
  hoursPaid: number;
  importedAt: string;
};

type PayrollTotalsTableProps = {
  data: PayrollPeriodTotal[];
  count: number;
};

/**
 * The payroll totals imported from the payroll system: gross wages and hours
 * paid per employee and pay period. Rows come in through Bulk Import only; a
 * re-import of a period updates its row.
 */
const PayrollTotalsTable = memo(({ data, count }: PayrollTotalsTableProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();

  const columns = useMemo<ColumnDef<PayrollPeriodTotal>[]>(
    () => [
      {
        accessorKey: "employeeId",
        header: t`Employee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.employeeId} />
        ),
        meta: { icon: <LuUser /> }
      },
      {
        accessorKey: "periodStart",
        header: t`Period Start`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(row.original.periodStart)}
          </span>
        ),
        meta: { icon: <LuCalendar /> }
      },
      {
        accessorKey: "periodEnd",
        header: t`Period End`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(row.original.periodEnd)}
          </span>
        ),
        meta: { icon: <LuCalendarCheck /> }
      },
      {
        accessorKey: "grossWages",
        header: t`Gross Wages`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney.format(Number(row.original.grossWages))}
          </span>
        ),
        meta: { icon: <LuCoins /> }
      },
      {
        accessorKey: "hoursPaid",
        header: t`Hours Paid`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuantity(Number(row.original.hoursPaid))}
          </span>
        ),
        meta: { icon: <LuClock /> }
      },
      {
        accessorKey: "importedAt",
        header: t`Imported`,
        cell: ({ row }) => (
          <DateTime value={row.original.importedAt} variant="date" />
        ),
        meta: { icon: <LuUpload /> }
      }
    ],
    [formatDate, formatMoney, formatQuantity, t]
  );

  return (
    <Table<PayrollPeriodTotal>
      data={data}
      count={count}
      columns={columns}
      importCSV={[{ table: "payrollPeriodTotal", label: t`Payroll totals` }]}
      title={t`Payroll Totals`}
    />
  );
});

PayrollTotalsTable.displayName = "PayrollTotalsTable";
export default PayrollTotalsTable;
