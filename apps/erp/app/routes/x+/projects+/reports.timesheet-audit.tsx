// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  projectReportPermissions,
  reportChargeNumber,
  type TimesheetEntryStatus as TimesheetEntryStatusType
} from "~/modules/projects/projects.models";
import { getProjectReportRange } from "~/modules/projects/projects.server";
import { getTimesheetAuditRows } from "~/modules/projects/projects.service";
import { TimesheetEntryStatus } from "~/modules/projects/ui/Element/TimesheetEntryStatus";
import {
  ChargeNumberCell,
  NumberCell,
  ProjectReport,
  projectReportHandle,
  ReportRangeSelect,
  useReportFormat
} from "~/modules/projects/ui/Reports/ProjectReport";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export const handle = projectReportHandle(
  "timesheet-audit",
  msg`Timesheet Audit`
);

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    ...projectReportPermissions["timesheet-audit"],
    role: "employee"
  });
  const db = getDatabaseClient();
  const range = await getProjectReportRange(db, request, companyId);
  const rows = await getTimesheetAuditRows(db, {
    companyId,
    from: range.startDate,
    to: range.endDate
  });
  return { ...range, rows };
}

type Row = Awaited<ReturnType<typeof loader>>["rows"][number];

/** A revision's before or after JSON, on one line and cut to the cell. */
function JsonCell({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span
      className="block max-w-80 truncate font-mono text-xs text-muted-foreground"
      title={value}
    >
      {value}
    </span>
  );
}

export default function TimesheetAuditReportRoute() {
  const { startDate, endDate, fiscalStartMonth, rows } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const format = useReportFormat();

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "recordedAt",
        header: t`Recorded At`,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.recordedAt}</span>
        )
      },
      {
        accessorKey: "rowType",
        header: t`Record`,
        cell: ({ row }) =>
          row.original.rowType === "Revision" ? t`Revision` : t`Entry`
      },
      {
        accessorKey: "entryDate",
        header: t`Entry Date`,
        cell: ({ row }) => format.date(row.original.entryDate)
      },
      {
        id: "chargeNumber",
        header: t`Charge Number`,
        cell: ({ row }) => (
          <ChargeNumberCell
            chargeNumber={reportChargeNumber(row.original)}
            name={row.original.elementName ?? row.original.projectName}
          />
        )
      },
      {
        accessorKey: "hours",
        header: t`Hours`,
        cell: ({ row }) => (
          <NumberCell>{format.hours(row.original.hours)}</NumberCell>
        )
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => (
          <TimesheetEntryStatus
            status={row.original.status as TimesheetEntryStatusType | null}
          />
        )
      },
      {
        accessorKey: "recordedBy",
        header: t`Recorded By`
      },
      {
        accessorKey: "lateReason",
        header: t`Late Reason`
      },
      {
        accessorKey: "reason",
        header: t`Reason`
      },
      {
        accessorKey: "before",
        header: t`Before`,
        cell: ({ row }) => <JsonCell value={row.original.before} />
      },
      {
        accessorKey: "after",
        header: t`After`,
        cell: ({ row }) => <JsonCell value={row.original.after} />
      }
    ],
    [t, format]
  );

  return (
    <ProjectReport<Row>
      title={t`Timesheet Audit`}
      data={rows}
      columns={columns}
      filters={<ReportRangeSelect fiscalStartMonth={fiscalStartMonth} />}
      csvHref={path.to.api.projectReport("timesheet-audit", {
        from: startDate,
        to: endDate
      })}
      groupRowsBy={{
        key: (row) => row.employeeName ?? "",
        header: (group) => (
          <span className="font-medium">{group[0]?.employeeName}</span>
        )
      }}
    />
  );
}
