// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  type Section6765Row,
  section6765FilingRows,
  section6765OfficerWages
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Plural, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  buildSection6765Input,
  projectReportPermissions,
  type RdComponentType,
  type RdSoftwareType
} from "~/modules/projects";
import {
  getRdTaxReport,
  taxYearParam
} from "~/modules/projects/projects.server";
import {
  useRdComponentTypeLabels,
  useRdSoftwareTypeLabels
} from "~/modules/projects/ui/RdTax/useRdTaxLabels";
import {
  NumberCell,
  ProjectReport,
  projectReportHandle,
  ReportTaxYearSelect,
  useReportFormat
} from "~/modules/projects/ui/Reports/ProjectReport";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export const handle = projectReportHandle(
  "rd-form-6765-g",
  msg`Form 6765 Section G`
);

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    ...projectReportPermissions["rd-form-6765-g"],
    role: "employee"
  });
  const report = await getRdTaxReport(getDatabaseClient(), client, {
    companyId,
    taxYear: taxYearParam(new URL(request.url).searchParams.get("taxYear")),
    withEmployees: true
  });
  const input = buildSection6765Input(
    report.rows,
    report.employees,
    report.components
  );
  const rows = section6765FilingRows(input.components);
  const totalRow = rows[rows.length - 1]!;

  return {
    taxYear: report.taxYear,
    currentTaxYear: report.currentTaxYear,
    ein: report.ein,
    rows,
    officerWages: section6765OfficerWages(
      input.officerWages,
      totalRow.wageTotal
    ),
    estimatedEmployeeCount: input.estimatedEmployeeCount,
    unknownCountryHours: input.unknownCountryHours
  };
}

export default function Section6765ReportRoute() {
  const {
    taxYear,
    currentTaxYear,
    ein,
    rows,
    officerWages,
    estimatedEmployeeCount,
    unknownCountryHours
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const format = useReportFormat({ wholeUnits: true });
  const componentTypeLabels = useRdComponentTypeLabels();
  const softwareTypeLabels = useRdSoftwareTypeLabels();

  const columns = useMemo<ColumnDef<Section6765Row>[]>(() => {
    const isComponent = (row: Section6765Row) =>
      !row.isAggregate && !row.isTotal;
    const money =
      (
        value: (row: Section6765Row) => number
      ): ColumnDef<Section6765Row>["cell"] =>
      ({ row }) => (
        <NumberCell bold={row.original.isTotal}>
          {format.money(value(row.original))}
        </NumberCell>
      );
    return [
      {
        accessorKey: "name",
        header: t`49(c) Business Component`,
        cell: ({ row }) =>
          row.original.isTotal ? (
            <span className="font-semibold">{t`Total`}</span>
          ) : row.original.isAggregate ? (
            <Plural
              value={row.original.aggregateCount}
              one="Aggregate of # business component"
              other="Aggregate of # business components"
            />
          ) : (
            row.original.name
          )
      },
      {
        accessorKey: "componentType",
        header: t`49(d) Component Type`,
        cell: ({ row }) =>
          isComponent(row.original) && row.original.componentType
            ? (componentTypeLabels[
                row.original.componentType as RdComponentType
              ] ?? row.original.componentType)
            : null
      },
      {
        accessorKey: "softwareType",
        header: t`49(e) Software Type`,
        cell: ({ row }) =>
          isComponent(row.original) && row.original.softwareType
            ? (softwareTypeLabels[
                row.original.softwareType as RdSoftwareType
              ] ?? row.original.softwareType)
            : null
      },
      {
        accessorKey: "research",
        header: t`50 Direct Research Wages`,
        cell: money((row) => row.research)
      },
      {
        accessorKey: "supervision",
        header: t`51 Direct Supervision Wages`,
        cell: money((row) => row.supervision)
      },
      {
        accessorKey: "support",
        header: t`52 Direct Support Wages`,
        cell: money((row) => row.support)
      },
      {
        accessorKey: "wageTotal",
        header: t`53 Total Wages`,
        cell: money((row) => row.wageTotal)
      },
      {
        accessorKey: "supplies",
        header: t`54 Supplies`,
        cell: money((row) => row.supplies)
      },
      {
        accessorKey: "computerRental",
        header: t`55 Computer Rental`,
        cell: money((row) => row.computerRental)
      },
      {
        accessorKey: "contractResearchQre",
        header: t`56 Applicable Contract Research`,
        cell: money((row) => row.contractResearchQre)
      },
      {
        accessorKey: "total",
        header: t`Total QRE`,
        cell: money((row) => row.total)
      }
    ];
  }, [t, format, componentTypeLabels, softwareTypeLabels]);

  const einText = ein ?? t`not set in company settings`;
  const notes = [
    t`EIN (49(a)): ${einText}`,
    t`Section E line 38, officers' wage QREs: ${format.money(officerWages)}`,
    t`The Total row sums every row, the aggregate row included. Its columns 53 to 56 go to Section F lines 42 to 45.`,
    t`All amounts are in whole dollars. Columns 53, Total QRE and the Total row add the rounded amounts.`,
    t`Column 49(b): enter the principal business activity (PBA) code from your return. Column 49(f) is required only on an amended return.`,
    t`Column 54 includes every Material cost. Remove the cost of depreciable property (§41(b)(2)(C)).`,
    t`Column 55 is not tracked in Carbon.`,
    t`Column 56 applies 65 % to all contract research, including Outside Processing and Purchased Service costs. Adjust payments that take another rate, and move basic research payments to line 46.`,
    ...(estimatedEmployeeCount > 0
      ? [
          t`Employees with wages estimated from labor cost: ${estimatedEmployeeCount}. Carbon estimates wages from the Labor ledger when no payroll is imported, and an estimate can exceed the employee's W-2 wages.`
        ]
      : []),
    ...(unknownCountryHours > 0
      ? [
          t`Hours excluded for an unknown work country: ${format.hours(unknownCountryHours)}`
        ]
      : [])
  ];

  return (
    <ProjectReport<Section6765Row>
      title={t`Form 6765 Section G`}
      data={rows}
      columns={columns}
      filters={
        <ReportTaxYearSelect
          taxYear={taxYear}
          currentTaxYear={currentTaxYear}
        />
      }
      csvHref={path.to.api.projectReport("rd-form-6765-g", {
        taxYear: String(taxYear)
      })}
    >
      <ul className="max-h-48 w-full shrink-0 list-disc space-y-1 overflow-y-auto border-t border-border bg-card py-3 pl-8 pr-4 text-xs text-muted-foreground">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </ProjectReport>
  );
}
