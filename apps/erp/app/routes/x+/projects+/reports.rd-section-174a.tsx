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
  buildSection174ARows,
  projectReportPermissions,
  type Section174ARow
} from "~/modules/projects";
import {
  getRdTaxReport,
  taxYearParam
} from "~/modules/projects/projects.server";
import {
  NumberCell,
  ProjectReport,
  projectReportHandle,
  ReportTaxYearSelect,
  useReportFormat
} from "~/modules/projects/ui/Reports/ProjectReport";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export const handle = projectReportHandle("rd-section-174a", msg`§174A R&E`);

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    ...projectReportPermissions["rd-section-174a"],
    role: "employee"
  });
  const report = await getRdTaxReport(getDatabaseClient(), client, {
    companyId,
    taxYear: taxYearParam(new URL(request.url).searchParams.get("taxYear")),
    withEmployees: false
  });
  return {
    taxYear: report.taxYear,
    currentTaxYear: report.currentTaxYear,
    rows: buildSection174ARows(report.rows, report.components)
  };
}

export default function Section174AReportRoute() {
  const { taxYear, currentTaxYear, rows } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const format = useReportFormat();

  const columns = useMemo<ColumnDef<Section174ARow>[]>(() => {
    const money =
      (
        value: (row: Section174ARow) => number
      ): ColumnDef<Section174ARow>["cell"] =>
      ({ row }) => (
        <NumberCell bold={row.original.isTotal}>
          {format.money(value(row.original))}
        </NumberCell>
      );
    return [
      {
        accessorKey: "readableId",
        header: t`Business Component`,
        cell: ({ row }) =>
          row.original.isTotal ? (
            <span className="font-semibold">{t`Total`}</span>
          ) : (
            <span className="flex items-baseline gap-2 truncate">
              <span className="font-medium">{row.original.readableId}</span>
              <span className="truncate text-muted-foreground">
                {row.original.name}
              </span>
            </span>
          )
      },
      {
        accessorKey: "domestic",
        header: t`Domestic`,
        cell: money((row) => row.domestic)
      },
      {
        accessorKey: "foreign",
        header: t`Foreign`,
        cell: money((row) => row.foreign)
      },
      {
        accessorKey: "unknown",
        header: t`Unknown Country`,
        cell: money((row) => row.unknown)
      },
      {
        accessorKey: "burden",
        header: t`Burden (for review)`,
        cell: money((row) => row.burden)
      },
      {
        accessorKey: "funded",
        header: t`Of Which Funded`,
        cell: money((row) => row.funded)
      },
      {
        accessorKey: "total",
        header: t`Total`,
        cell: money((row) => row.total)
      }
    ];
  }, [t, format]);

  return (
    <ProjectReport<Section174ARow>
      title={t`§174A R&E`}
      data={rows}
      columns={columns}
      filters={
        <ReportTaxYearSelect
          taxYear={taxYear}
          currentTaxYear={currentTaxYear}
        />
      }
      csvHref={path.to.api.projectReport("rd-section-174a", {
        taxYear: String(taxYear)
      })}
    />
  );
}
