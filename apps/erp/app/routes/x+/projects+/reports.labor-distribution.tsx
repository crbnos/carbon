// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { datetime } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  buildLaborDistribution,
  getLaborDistributionPeriods,
  getLaborDistributionRows,
  NO_PAYROLL_IMPORTED,
  type ProjectCostObjective,
  projectReportPermissions
} from "~/modules/projects";
import {
  NumberCell,
  ProjectReport,
  projectReportHandle,
  ReportPeriodSelect,
  useReportFormat
} from "~/modules/projects/ui/Reports/ProjectReport";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export const handle = projectReportHandle(
  "labor-distribution",
  msg`Labor Distribution`
);

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    ...projectReportPermissions["labor-distribution"],
    role: "employee"
  });
  const db = getDatabaseClient();
  const [periods, timeZone] = await Promise.all([
    getLaborDistributionPeriods(db, { companyId }),
    getCompanyTimeZone(db, companyId)
  ]);

  // The chosen period, else the latest period that has started.
  const today = datetime.today(timeZone).toString();
  const requested = new URL(request.url).searchParams.get("periodId");
  const periodId =
    periods.find((period) => period.id === requested)?.id ??
    periods.find((period) => period.startDate <= today)?.id ??
    periods[0]?.id ??
    null;

  const rows = periodId
    ? await getLaborDistributionRows(db, { companyId, periodId })
    : null;

  return {
    periods,
    periodId,
    employees: rows ? buildLaborDistribution(rows) : []
  };
}

type Employee = Awaited<ReturnType<typeof loader>>["employees"][number];

/** One line of an employee, or the employee's Total line. */
type Row = {
  id: string;
  employeeKey: string;
  employeeName: string | null;
  isTotal: boolean;
  chargeNumber: string;
  name: string | null;
  costObjective: ProjectCostObjective | null;
  hours: number;
  direct: number;
  indirect: number;
  unclassified: number;
  unallowable: number;
  total: number;
  timecardHours: number | null;
  hoursDifference: number | null;
  grossWages: number | null;
  dollarsDifference: number | null;
  note: string | null;
};

function toRows(employees: Employee[]): Row[] {
  return employees.flatMap((employee, index) => {
    const employeeKey = employee.employeeId ?? `none-${index}`;
    return [
      ...employee.lines.map((line, lineIndex) => ({
        ...line,
        id: `${employeeKey}:${lineIndex}`,
        employeeKey,
        employeeName: employee.employeeName,
        isTotal: false,
        name: line.elementName ?? line.projectName,
        timecardHours: null,
        hoursDifference: null,
        grossWages: null,
        dollarsDifference: null,
        note: null
      })),
      {
        ...employee.total,
        id: `${employeeKey}:total`,
        employeeKey,
        employeeName: employee.employeeName,
        isTotal: true,
        chargeNumber: "",
        name: null,
        costObjective: null
      }
    ];
  });
}

export default function LaborDistributionReportRoute() {
  const { periods, periodId, employees } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const format = useReportFormat();
  const rows = useMemo(() => toRows(employees), [employees]);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const hours =
      (value: (row: Row) => number | null): ColumnDef<Row>["cell"] =>
      ({ row }) => (
        <NumberCell bold={row.original.isTotal}>
          {format.hours(value(row.original))}
        </NumberCell>
      );
    const money =
      (value: (row: Row) => number | null): ColumnDef<Row>["cell"] =>
      ({ row }) => (
        <NumberCell bold={row.original.isTotal}>
          {format.money(value(row.original))}
        </NumberCell>
      );
    return [
      {
        accessorKey: "chargeNumber",
        header: t`Charge Number`,
        cell: ({ row }) =>
          row.original.isTotal ? (
            <span className="font-semibold">{t`Total`}</span>
          ) : (
            <span className="flex items-baseline gap-2 truncate">
              <span className="font-medium">{row.original.chargeNumber}</span>
              {row.original.name && (
                <span className="truncate text-muted-foreground">
                  {row.original.name}
                </span>
              )}
            </span>
          )
      },
      {
        accessorKey: "costObjective",
        header: t`Cost Objective`
      },
      {
        accessorKey: "hours",
        header: t`Hours`,
        cell: hours((row) => row.hours)
      },
      {
        accessorKey: "direct",
        header: t`Direct`,
        cell: money((row) => row.direct)
      },
      {
        accessorKey: "indirect",
        header: t`Indirect`,
        cell: money((row) => row.indirect)
      },
      {
        accessorKey: "unclassified",
        header: t`Unclassified`,
        cell: money((row) => row.unclassified)
      },
      {
        accessorKey: "unallowable",
        header: t`Unallowable`,
        cell: money((row) => row.unallowable)
      },
      {
        accessorKey: "total",
        header: t`Total`,
        cell: money((row) => row.total)
      },
      {
        accessorKey: "timecardHours",
        header: t`Timecard Hours`,
        cell: hours((row) => row.timecardHours)
      },
      {
        accessorKey: "hoursDifference",
        header: t`Hours Difference`,
        cell: hours((row) => row.hoursDifference)
      },
      {
        accessorKey: "grossWages",
        header: t`Gross Wages`,
        cell: money((row) => row.grossWages)
      },
      {
        accessorKey: "dollarsDifference",
        header: t`Dollars Difference`,
        cell: money((row) => row.dollarsDifference)
      },
      {
        accessorKey: "note",
        header: t`Note`,
        cell: ({ row }) =>
          row.original.note === NO_PAYROLL_IMPORTED ? (
            <span className="text-muted-foreground">{t`No payroll imported`}</span>
          ) : (
            row.original.note
          )
      }
    ];
  }, [t, format]);

  return (
    <ProjectReport<Row>
      title={t`Labor Distribution`}
      data={rows}
      columns={columns}
      filters={<ReportPeriodSelect periods={periods} periodId={periodId} />}
      csvHref={path.to.api.projectReport(
        "labor-distribution",
        periodId ? { periodId } : {}
      )}
      groupRowsBy={{
        key: (row) => row.employeeKey,
        header: (group) => (
          <span className="font-medium">
            {group[0]?.employeeName ?? t`No employee`}
          </span>
        )
      }}
    />
  );
}
