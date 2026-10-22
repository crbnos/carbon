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
  reportChargeNumber
} from "~/modules/projects/projects.models";
import {
  getLaborTransfers,
  getProjectReportRange
} from "~/modules/projects/projects.service";
import {
  NumberCell,
  ProjectReport,
  projectReportHandle,
  ReportRangeSelect,
  useReportFormat
} from "~/modules/projects/ui/Reports/ProjectReport";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export const handle = projectReportHandle(
  "labor-transfers",
  msg`Labor Transfers`
);

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    ...projectReportPermissions["labor-transfers"],
    role: "employee"
  });
  const db = getDatabaseClient();
  const range = await getProjectReportRange(db, request, companyId);
  const rows = await getLaborTransfers(db, {
    companyId,
    from: range.startDate,
    to: range.endDate
  });
  return { ...range, rows };
}

type Row = Awaited<ReturnType<typeof loader>>["rows"][number];

export default function LaborTransfersReportRoute() {
  const { startDate, endDate, fiscalStartMonth, rows } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const format = useReportFormat();

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "transferDate",
        header: t`Transfer Date`,
        cell: ({ row }) => format.date(row.original.transferDate)
      },
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
        accessorKey: "hours",
        header: t`Hours`,
        cell: ({ row }) => (
          <NumberCell>{format.hours(row.original.hours)}</NumberCell>
        )
      },
      {
        id: "from",
        header: t`From`,
        cell: ({ row }) =>
          reportChargeNumber({
            projectIdentifier: row.original.fromProjectIdentifier,
            elementReadableId: row.original.fromElementReadableId
          })
      },
      {
        id: "to",
        header: t`To`,
        cell: ({ row }) =>
          reportChargeNumber({
            projectIdentifier: row.original.toProjectIdentifier,
            elementReadableId: row.original.toElementReadableId
          })
      },
      {
        accessorKey: "reason",
        header: t`Reason`
      },
      {
        accessorKey: "requesterName",
        header: t`Requested By`
      },
      {
        accessorKey: "approverName",
        header: t`Approved By`
      },
      {
        accessorKey: "approvedDate",
        header: t`Approved On`,
        cell: ({ row }) => format.date(row.original.approvedDate)
      },
      {
        accessorKey: "daysAfterEntry",
        header: t`Days After Entry`,
        cell: ({ row }) => (
          <NumberCell>{row.original.daysAfterEntry}</NumberCell>
        )
      }
    ],
    [t, format]
  );

  return (
    <ProjectReport<Row>
      title={t`Labor Transfers`}
      data={rows}
      columns={columns}
      filters={<ReportRangeSelect fiscalStartMonth={fiscalStartMonth} />}
      csvHref={path.to.api.projectReport("labor-transfers", {
        from: startDate,
        to: endDate
      })}
    />
  );
}
