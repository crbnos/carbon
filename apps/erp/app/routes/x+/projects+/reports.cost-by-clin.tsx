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
import { getCostByClin, projectReportPermissions } from "~/modules/projects";
import { getProjectReportRange } from "~/modules/projects/projects.server";
import {
  NumberCell,
  ProjectReport,
  projectReportHandle,
  ReportRangeSelect,
  useReportFormat
} from "~/modules/projects/ui/Reports/ProjectReport";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export const handle = projectReportHandle("cost-by-clin", msg`Cost by CLIN`);

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    ...projectReportPermissions["cost-by-clin"],
    role: "employee"
  });
  const db = getDatabaseClient();
  const range = await getProjectReportRange(db, request, companyId);
  const rows = await getCostByClin(db, {
    companyId,
    from: range.startDate,
    to: range.endDate
  });
  return { ...range, rows };
}

type Row = Awaited<ReturnType<typeof loader>>["rows"][number];

export default function CostByClinReportRoute() {
  const { startDate, endDate, fiscalStartMonth, rows } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const format = useReportFormat();

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const money = (
      value: (row: Row) => number | null
    ): ColumnDef<Row>["cell"] =>
      function MoneyCell({ row }) {
        return <NumberCell>{format.money(value(row.original))}</NumberCell>;
      };
    return [
      {
        accessorKey: "lineItemNumber",
        header: t`CLIN`,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.lineItemNumber}</span>
        )
      },
      {
        accessorKey: "description",
        header: t`Description`
      },
      {
        accessorKey: "elementReadableId",
        header: t`Billing Element`
      },
      {
        accessorKey: "allowableCost",
        header: t`Allowable Cost`,
        cell: money((row) => row.allowableCost)
      },
      {
        accessorKey: "unallowableCost",
        header: t`Unallowable Cost`,
        cell: money((row) => row.unallowableCost)
      },
      {
        accessorKey: "fundedCost",
        header: t`Funded Cost`,
        cell: money((row) => row.fundedCost)
      },
      {
        accessorKey: "fundedAmount",
        header: t`Funded Amount`,
        cell: money((row) => row.fundedAmount)
      },
      {
        accessorKey: "billedAmount",
        header: t`Billed`,
        cell: money((row) => row.billedAmount)
      }
    ];
  }, [t, format]);

  return (
    <ProjectReport<Row>
      title={t`Cost by CLIN`}
      data={rows}
      columns={columns}
      filters={<ReportRangeSelect fiscalStartMonth={fiscalStartMonth} />}
      csvHref={path.to.api.projectReport("cost-by-clin", {
        from: startDate,
        to: endDate
      })}
      groupRowsBy={{
        key: (row) => row.contractReadableId,
        header: (group) => (
          <span className="flex items-baseline gap-2">
            <span className="font-medium">{group[0]?.contractReadableId}</span>
            <span className="text-muted-foreground">
              {[group[0]?.contractName, group[0]?.customerName]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        )
      }}
    />
  );
}
