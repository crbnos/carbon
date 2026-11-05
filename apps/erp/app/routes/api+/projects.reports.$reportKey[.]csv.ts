// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import {
  chunkArray,
  section6765FilingRows,
  section6765OfficerWages
} from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  buildLaborDistribution,
  buildSection174ARows,
  buildSection6765Input,
  isProjectReportKey,
  isRdTaxReportKey,
  type ProjectReportKey,
  projectReportPermissions,
  type RdComponent,
  rdSoftwareTypeIrsText,
  type rdTaxReportKeys,
  reportChargeNumber
} from "~/modules/projects/projects.models";
import {
  getCostByClin,
  getLaborDistributionRows,
  getLaborTransfers,
  getLateTimesheetEntries,
  getMissingTimesheetDays,
  type getRdEmployeeYear,
  type getRdLedgerRows,
  getRdTaxReport,
  getTimesheetAuditRows,
  taxYearParam
} from "~/modules/projects/projects.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "projects-reports-csv");

/** Rows encoded and written per step of the stream. */
const PAGE_SIZE = 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Csv = { fields: string[]; rows: Record<string, unknown>[] };

/**
 * GET — one Government Contracting report as CSV. Labor distribution reads
 * `periodId`, an accounting period; the two R&D tax reports read `taxYear`
 * (decision D9); the others read `from` and `to` (`YYYY-MM-DD`). The reads
 * use the Kysely client, so the permission check above them is the gate.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const reportKey = params.reportKey ?? "";
  if (!isProjectReportKey(reportKey)) {
    throw new Response("The report could not be found", { status: 404 });
  }

  const { client, companyId } = await requirePermissions(request, {
    ...projectReportPermissions[reportKey],
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
    } else if (isRdTaxReportKey(reportKey)) {
      const taxYear = taxYearParam(searchParams.get("taxYear"));
      if (taxYear === null) {
        throw new Response("Choose a tax year", { status: 400 });
      }
      const report = await getRdTaxReport(db, client, {
        companyId,
        taxYear,
        withEmployees: reportKey === "rd-form-6765-g"
      });
      csv =
        reportKey === "rd-section-174a"
          ? section174ACsv(report.rows, report.components)
          : section6765Csv(report.rows, report.employees, report.components, {
              ein: report.ein
            });
      fileName = `${reportKey}-${taxYear}.csv`;
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
  reportKey: Exclude<
    ProjectReportKey,
    "labor-distribution" | (typeof rdTaxReportKeys)[number]
  >,
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

const SECTION_174A_FIELDS = [
  "Business Component",
  "Name",
  "Domestic",
  "Foreign",
  "Unknown Country",
  "Burden (for review)",
  "Of Which Funded",
  "Total"
];

/** One line per business component, then the totals line. */
function section174ACsv(
  rows: Awaited<ReturnType<typeof getRdLedgerRows>>,
  components: RdComponent[]
): Csv {
  return {
    fields: SECTION_174A_FIELDS,
    rows: buildSection174ARows(rows, components).map((row) => ({
      "Business Component": row.isTotal ? "Total" : row.readableId,
      Name: row.isTotal ? null : row.name,
      Domestic: row.domestic,
      Foreign: row.foreign,
      "Unknown Country": row.unknown,
      "Burden (for review)": row.burden,
      "Of Which Funded": row.funded,
      Total: row.total
    }))
  };
}

const SECTION_6765_FIELDS = [
  "49(a) EIN",
  "49(b) Principal Business Activity Code",
  "49(c) Business Component",
  "49(d) Component Type",
  "49(e) Software Type",
  "49(f) Information Sought to Be Discovered",
  "50 Direct Research Wages",
  "51 Direct Supervision Wages",
  "52 Direct Support Wages",
  "53 Total Wages",
  "54 Supplies",
  "55 Computer Rental",
  "56 Applicable Contract Research",
  "Total QRE"
];

/**
 * Form 6765 Section G in whole dollars: one line per row of
 * `section6765FilingRows` (descending QRE, the aggregate row, then the Total
 * row), then the notes. Column 53 is the sum of columns 50–52 (decision D8,
 * confirmed against the Form 6765 instructions). The aggregate and Total rows
 * leave 49(a), (b), (d), (e) and (f) blank, as the instructions say.
 */
function section6765Csv(
  rows: Awaited<ReturnType<typeof getRdLedgerRows>>,
  employees: Awaited<ReturnType<typeof getRdEmployeeYear>>,
  components: RdComponent[],
  company: { ein: string | null }
): Csv {
  const input = buildSection6765Input(rows, employees, components);
  const filingRows = section6765FilingRows(input.components);
  const totalRow = filingRows[filingRows.length - 1]!;
  const aggregateCount = filingRows.find(
    (row) => row.isAggregate
  )?.aggregateCount;
  const note = (text: string) => ({ "49(a) EIN": text });
  return {
    fields: SECTION_6765_FIELDS,
    rows: [
      ...filingRows.map((row) => {
        const isComponent = !row.isAggregate && !row.isTotal;
        return {
          "49(a) EIN": isComponent ? company.ein : null,
          "49(b) Principal Business Activity Code": null,
          "49(c) Business Component": row.name,
          "49(d) Component Type": isComponent ? row.componentType : null,
          "49(e) Software Type": isComponent
            ? rdSoftwareTypeIrsText(row.softwareType)
            : null,
          "49(f) Information Sought to Be Discovered": null,
          "50 Direct Research Wages": row.research,
          "51 Direct Supervision Wages": row.supervision,
          "52 Direct Support Wages": row.support,
          "53 Total Wages": row.wageTotal,
          "54 Supplies": row.supplies,
          "55 Computer Rental": row.computerRental,
          "56 Applicable Contract Research": row.contractResearchQre,
          "Total QRE": row.total
        };
      }),
      note(
        `Section E line 38, officers' wage QREs: ${section6765OfficerWages(input.officerWages, totalRow.wageTotal)}`
      ),
      note(
        "The Total row sums every row, the aggregate row included. Its columns 53 to 56 go to Section F lines 42 to 45."
      ),
      note(
        "All amounts are in whole dollars. Columns 53, Total QRE and the Total row add the rounded amounts."
      ),
      ...(aggregateCount
        ? [
            note(
              `Aggregate Business Components: the sum of ${aggregateCount} business components.`
            )
          ]
        : []),
      note(
        "Column 49(b): enter the principal business activity (PBA) code from your return."
      ),
      note(
        "Column 49(f): required only on an amended return. Enter the information sought to be discovered for each business component."
      ),
      note("Column 55: Not tracked in Carbon"),
      note(
        "Column 56 applies 65 % to all contract research. Adjust payments to a qualified research consortium (75 %) or for qualified energy research by an eligible small business, university or federal laboratory (100 %), and move basic research payments to line 46."
      ),
      note(
        "Column 56 includes Outside Processing and Purchased Service costs. They are contract research only when the work meets Reg. §1.41-2(e)."
      ),
      note(
        "Column 54 includes every Material cost. Remove the cost of depreciable property (§41(b)(2)(C))."
      ),
      ...(input.estimatedEmployeeCount > 0
        ? [
            note(
              `Employees with wages estimated from labor cost: ${input.estimatedEmployeeCount}`
            ),
            note(
              "Carbon estimates wages from the Labor ledger when no payroll is imported. An estimate can exceed the employee's W-2 wages."
            )
          ]
        : []),
      ...(input.unknownCountryHours > 0
        ? [
            note(
              `Hours excluded for an unknown work country: ${input.unknownCountryHours}`
            )
          ]
        : [])
    ]
  };
}
