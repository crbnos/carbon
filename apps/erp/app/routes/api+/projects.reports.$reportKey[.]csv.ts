// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  buildLaborDistribution,
  getCostByClin,
  getLaborDistributionRows,
  getLaborTransfers,
  getLateTimesheetEntries,
  getMissingTimesheetDays,
  getTimesheetAuditRows,
  isProjectReportKey,
  type ProjectReportKey,
  reportChargeNumber
} from "~/modules/projects";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "projects-reports-csv");

/** Rows encoded and written per step of the stream. */
const PAGE_SIZE = 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The permissions each report needs (plan Task 31, step 3). */
const REPORT_PERMISSIONS: Record<
  ProjectReportKey,
  { view: string | string[] }
> = {
  "late-entries": { view: "projects" },
  "missing-time": { view: "projects" },
  "labor-transfers": { view: "projects" },
  "timesheet-audit": { view: "projects" },
  "labor-distribution": { view: ["projects", "people"] },
  "cost-by-clin": { view: "sales" }
};

type Csv = { fields: string[]; rows: Record<string, unknown>[] };

/**
 * GET — one Government Contracting report as CSV. Every report but labor
 * distribution reads `from` and `to` (`YYYY-MM-DD`); labor distribution reads
 * `periodId`, an accounting period. The reads use the Kysely client, so the
 * permission check above them is the gate.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const reportKey = params.reportKey ?? "";
  if (!isProjectReportKey(reportKey)) {
    throw new Response("The report could not be found", { status: 404 });
  }

  const { companyId } = await requirePermissions(request, {
    ...REPORT_PERMISSIONS[reportKey],
    role: "employee"
  });

  const searchParams = new URL(request.url).searchParams;
  const db = getDatabaseClient();

  let csv: Csv;
  let fileName: string;
  try {
    if (reportKey === "labor-distribution") {
      const periodId = searchParams.get("periodId");
      if (!periodId) {
        throw new Response("Choose an accounting period", { status: 400 });
      }
      const rows = await getLaborDistributionRows(db, { companyId, periodId });
      if (!rows) {
        throw new Response("The accounting period could not be found", {
          status: 404
        });
      }
      csv = laborDistributionCsv(rows);
      fileName = `labor-distribution-${rows.period.startDate}-${rows.period.endDate}.csv`;
    } else {
      const from = searchParams.get("from") ?? "";
      const to = searchParams.get("to") ?? "";
      if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
        throw new Response("Choose a date range with a start before its end", {
          status: 400
        });
      }
      csv = await rangeReportCsv(reportKey, db, { companyId, from, to });
      fileName = `${reportKey}-${from}-${to}.csv`;
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    logger.error("Failed to build the project report", {
      companyId,
      reportKey,
      error: err
    });
    throw new Response("Failed to export the report", { status: 500 });
  }

  const encoder = new TextEncoder();
  const pages = chunkArray(csv.rows, PAGE_SIZE);
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === 0 && pages.length === 0) {
        controller.enqueue(
          encoder.encode(encodeCsv([], { fields: csv.fields }))
        );
      }
      if (index >= pages.length) {
        controller.close();
        return;
      }
      const text = encodeCsv(pages[index]!, {
        fields: csv.fields,
        header: index === 0
      });
      controller.enqueue(encoder.encode(index === 0 ? text : `\r\n${text}`));
      index += 1;
    }
  });

  return new Response(body, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}

async function rangeReportCsv(
  reportKey: Exclude<ProjectReportKey, "labor-distribution">,
  db: ReturnType<typeof getDatabaseClient>,
  range: { companyId: string; from: string; to: string }
): Promise<Csv> {
  switch (reportKey) {
    case "late-entries": {
      const rows = await getLateTimesheetEntries(db, range);
      return {
        fields: [
          "Employee",
          "Entry Date",
          "Entered On",
          "Hours",
          "Charge Number",
          "Project",
          "Element",
          "Status",
          "Late Reason"
        ],
        rows: rows.map((row) => ({
          Employee: row.employeeName,
          "Entry Date": row.entryDate,
          "Entered On": row.createdDate,
          Hours: row.hours,
          "Charge Number": reportChargeNumber(row),
          Project: row.projectName,
          Element: row.elementName,
          Status: row.status,
          "Late Reason": row.lateReason
        }))
      };
    }
    case "missing-time": {
      const rows = await getMissingTimesheetDays(db, range);
      return {
        fields: ["Date", "Employee", "Manager"],
        rows: rows.map((row) => ({
          Date: row.date,
          Employee: row.employeeName ?? row.employeeId,
          Manager: row.managerName
        }))
      };
    }
    case "labor-transfers": {
      const rows = await getLaborTransfers(db, range);
      return {
        fields: [
          "Transfer Date",
          "Employee",
          "Entry Date",
          "Hours",
          "From",
          "To",
          "Reason",
          "Requested By",
          "Approved By",
          "Approved On",
          "Days After Entry"
        ],
        rows: rows.map((row) => ({
          "Transfer Date": row.transferDate,
          Employee: row.employeeName,
          "Entry Date": row.entryDate,
          Hours: row.hours,
          From: reportChargeNumber({
            projectIdentifier: row.fromProjectIdentifier,
            elementReadableId: row.fromElementReadableId
          }),
          To: reportChargeNumber({
            projectIdentifier: row.toProjectIdentifier,
            elementReadableId: row.toElementReadableId
          }),
          Reason: row.reason,
          "Requested By": row.requesterName,
          "Approved By": row.approverName,
          "Approved On": row.approvedDate,
          "Days After Entry": row.daysAfterEntry
        }))
      };
    }
    case "timesheet-audit": {
      const rows = await getTimesheetAuditRows(db, range);
      return {
        fields: [
          "Employee",
          "Recorded At",
          "Record",
          "Entry ID",
          "Entry Date",
          "Charge Number",
          "Hours",
          "Status",
          "Recorded By",
          "Late Reason",
          "Reason",
          "Before",
          "After"
        ],
        rows: rows.map((row) => ({
          Employee: row.employeeName,
          "Recorded At": row.recordedAt,
          Record: row.rowType,
          "Entry ID": row.timesheetEntryId,
          "Entry Date": row.entryDate,
          "Charge Number": reportChargeNumber(row),
          Hours: row.hours,
          Status: row.status,
          "Recorded By": row.recordedBy,
          "Late Reason": row.lateReason,
          Reason: row.reason,
          Before: row.before,
          After: row.after
        }))
      };
    }
    case "cost-by-clin": {
      const rows = await getCostByClin(db, range);
      return {
        fields: [
          "Contract",
          "Customer",
          "CLIN",
          "Description",
          "Billing Element",
          "Allowable Cost",
          "Unallowable Cost",
          "Funded Cost",
          "Funded Amount",
          "Billed"
        ],
        rows: rows.map((row) => ({
          Contract: row.contractReadableId,
          Customer: row.customerName,
          CLIN: row.lineItemNumber,
          Description: row.description,
          "Billing Element": row.elementReadableId,
          "Allowable Cost": row.allowableCost,
          "Unallowable Cost": row.unallowableCost,
          "Funded Cost": row.fundedCost,
          "Funded Amount": row.fundedAmount,
          Billed: row.billedAmount
        }))
      };
    }
  }
}

const LABOR_DISTRIBUTION_FIELDS = [
  "Employee",
  "Charge Number",
  "Project",
  "Element",
  "Cost Objective",
  "Hours",
  "Direct",
  "Indirect",
  "Unclassified",
  "Unallowable",
  "Total",
  "Timecard Hours",
  "Hours Difference",
  "Gross Wages",
  "Dollars Difference",
  "Note"
];

/** Each employee's lines, then a Total row with the reconciliation. */
function laborDistributionCsv(
  rows: NonNullable<Awaited<ReturnType<typeof getLaborDistributionRows>>>
): Csv {
  const employees = buildLaborDistribution(rows);
  return {
    fields: LABOR_DISTRIBUTION_FIELDS,
    rows: employees.flatMap((employee) => [
      ...employee.lines.map((line) => ({
        Employee: employee.employeeName,
        "Charge Number": line.chargeNumber,
        Project: line.projectName,
        Element: line.elementName,
        "Cost Objective": line.costObjective,
        Hours: line.hours,
        Direct: line.direct,
        Indirect: line.indirect,
        Unclassified: line.unclassified,
        Unallowable: line.unallowable,
        Total: line.total
      })),
      {
        Employee: employee.employeeName,
        "Charge Number": "Total",
        Hours: employee.total.hours,
        Direct: employee.total.direct,
        Indirect: employee.total.indirect,
        Unclassified: employee.total.unclassified,
        Unallowable: employee.total.unallowable,
        Total: employee.total.total,
        "Timecard Hours": employee.total.timecardHours,
        "Hours Difference": employee.total.hoursDifference,
        "Gross Wages": employee.total.grossWages,
        "Dollars Difference": employee.total.dollarsDifference,
        Note: employee.total.note
      }
    ])
  };
}
