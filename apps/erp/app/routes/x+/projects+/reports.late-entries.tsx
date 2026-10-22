// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { type LoaderFunctionArgs, useLoaderData } from "react-router";
import {
  projectReportPermissions,
  reportChargeNumber,
  type TimesheetEntryStatus as TimesheetEntryStatusType
} from "~/modules/projects/projects.models";
import {
  getLateTimesheetEntries,
  getProjectReportRange
} from "~/modules/projects/projects.service";
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

export const handle = projectReportHandle("late-entries", msg`Late Entries`);

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    ...projectReportPermissions["late-entries"],
    role: "employee"
  });
  const db = getDatabaseClient();
  const range = await getProjectReportRange(db, request, companyId);
  const rows = await getLateTimesheetEntries(db, {
    companyId,
    from: range.startDate,
    to: range.endDate
  });
  return { ...range, rows };
}

type Row = Awaited<ReturnType<typeof loader>>["rows"][number];

export default function LateEntriesReportRoute() {
  const { startDate, endDate, fiscalStartMonth, rows } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const format = useReportFormat();

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "employeeName",
        header: t`Employee`
      },
      {
        accessorKey: "entryDate",
        header: t`Entry Date`,
        cell: ({ row }) => format.date(row.original.entryDate)
      },
      {
        accessorKey: "createdDate",
        header: t`Entered On`,
        cell: ({ row }) => format.date(row.original.createdDate)
      },
      {
        accessorKey: "hours",
        header: t`Hours`,
        cell: ({ row }) => (
          <NumberCell>{format.hours(row.original.hours)}</NumberCell>
        )
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
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => (
          <TimesheetEntryStatus
            status={row.original.status as TimesheetEntryStatusType}
          />
        )
      },
      {
        accessorKey: "lateReason",
        header: t`Late Reason`
      }
    ],
    [t, format]
  );

  return (
    <ProjectReport<Row>
      title={t`Late Entries`}
      data={rows}
      columns={columns}
      filters={<ReportRangeSelect fiscalStartMonth={fiscalStartMonth} />}
      csvHref={path.to.api.projectReport("late-entries", {
        from: startDate,
        to: endDate
      })}
    />
  );
}
