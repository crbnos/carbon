// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The AR and AP aging CSV downloads. The same data is on screen for a
// Receivables or Payables viewer (the workbenches) and for a Reporting viewer
// (the aging reports), so the download admits either; the page loaders
// keep their own, narrower, permission.

import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllByIds, fetchAllRecords } from "@carbon/database";
import { anyOf } from "@carbon/database/access";
import { CSV_CONTENT_TYPE, encodeCsvTable } from "@carbon/files/csv";
import { resolveLanguage } from "@carbon/locale";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { setupI18n } from "@lingui/core";
import ExcelJS from "exceljs";
import {
  type AgingCsvCounterparty,
  type AgingCsvDocument,
  type AgingCsvLabels,
  agingBucketMessages,
  agingCsvMessages,
  agingCsvTable
} from "~/modules/invoicing/invoicing.reports";
import {
  getAgingParams,
  getAgingUnappliedPayments,
  getApAging,
  getApOpenBySupplier,
  getArAging,
  getArOpenByCustomer
} from "~/modules/invoicing/invoicing.service";
import { getCatalog, preloadCatalog } from "~/services/lingui";

const logger = getLogger("erp", "reports-aging-export");

export async function resolveAgingExportRequest(
  request: Request,
  side: "ar" | "ap"
) {
  const { client, companyId } = await authorize(
    request,
    anyOf(
      [
        side === "ar" ? "invoicing.receivables" : "invoicing.payables",
        "accounting.reporting"
      ],
      "View"
    )
  );

  const params = await getAgingParams(client, companyId, request);
  // Party RLS requires sales/purchasing view, which an authorized aging viewer
  // need not have. Only the company-scoped name lookup uses this client.
  return { client, partyClient: getCarbonServiceRole(), companyId, ...params };
}

export async function getAgingCsvLabels(
  request: Request,
  party: "Customer" | "Supplier",
  bucketDays: [number, number, number]
): Promise<AgingCsvLabels> {
  const language = resolveLanguage(getPreferenceHeaders(request).locale);
  await preloadCatalog(language);
  const i18n = setupI18n();
  i18n.load(language, getCatalog(language));
  i18n.activate(language);
  const translate = i18n._.bind(i18n);
  const bucketMessages = agingBucketMessages(bucketDays);

  return {
    party: translate(
      party === "Customer"
        ? agingCsvMessages.customer
        : agingCsvMessages.supplier
    ),
    document: translate(agingCsvMessages.document),
    transactionDate: translate(agingCsvMessages.transactionDate),
    documentType: translate(agingCsvMessages.documentType),
    invoice: translate(agingCsvMessages.invoice),
    creditMemo: translate(agingCsvMessages.creditMemo),
    debitMemo: translate(agingCsvMessages.debitMemo),
    receipt: translate(agingCsvMessages.receipt),
    disbursement: translate(agingCsvMessages.disbursement),
    supplierInvoiceNumber: translate(agingCsvMessages.supplierInvoiceNumber),
    dueDate: translate(agingCsvMessages.dueDate),
    originalAmount: translate(agingCsvMessages.originalAmount),
    daysPastDue: translate(agingCsvMessages.daysPastDue),
    paymentTerm: translate(agingCsvMessages.paymentTerm),
    current: translate(agingCsvMessages.current),
    bucket1: translate(bucketMessages.bucket1),
    bucket2: translate(bucketMessages.bucket2),
    bucket3: translate(bucketMessages.bucket3),
    bucket4: translate(bucketMessages.bucket4),
    unapplied: translate(agingCsvMessages.unapplied),
    total: translate(agingCsvMessages.total)
  };
}

export async function loadAgingExportTable(
  request: Request,
  side: "ar" | "ap"
) {
  const { client, partyClient, companyId, asOfDate, agingMethod, bucketDays } =
    await resolveAgingExportRequest(request, side);
  let aging: AgingCsvCounterparty[];
  let open: AgingCsvDocument[];
  if (side === "ar") {
    const [agingResult, openResult] = await Promise.all([
      fetchAllRecords(() =>
        getArAging(client, companyId, asOfDate, { agingMethod, bucketDays })
          .order("total", { ascending: false })
          .order("customerId")
      ),
      fetchAllRecords(() =>
        getArOpenByCustomer(client, companyId, asOfDate)
          .order("customerId")
          .order("dateDue", { nullsFirst: false })
          .order("documentId")
          .order("documentType")
      )
    ]);
    if (agingResult.error || openResult.error) {
      logger.error("Failed to export AR aging", {
        companyId,
        error: agingResult.error ?? openResult.error
      });
      throw new Response("AR aging could not be exported.", { status: 500 });
    }
    aging = agingResult.data.map((row) => ({
      ...row,
      partyId: row.customerId
    }));
    open = openResult.data.map((row) => ({
      ...row,
      partyId: row.customerId
    }));
  } else {
    const [agingResult, openResult] = await Promise.all([
      fetchAllRecords(() =>
        getApAging(client, companyId, asOfDate, { agingMethod, bucketDays })
          .order("total", { ascending: false })
          .order("supplierId")
      ),
      fetchAllRecords(() =>
        getApOpenBySupplier(client, companyId, asOfDate)
          .order("supplierId")
          .order("dateDue", { nullsFirst: false })
          .order("documentId")
          .order("documentType")
      )
    ]);
    if (agingResult.error || openResult.error) {
      logger.error("Failed to export AP aging", {
        companyId,
        error: agingResult.error ?? openResult.error
      });
      throw new Response("AP aging could not be exported.", { status: 500 });
    }
    aging = agingResult.data.map((row) => ({
      ...row,
      partyId: row.supplierId
    }));
    open = openResult.data.map((row) => ({
      ...row,
      partyId: row.supplierId
    }));
  }

  const paymentsResult = await fetchAllRecords(() =>
    getAgingUnappliedPayments(client, companyId, asOfDate, side)
      .order("partyId")
      .order("documentId")
  );
  if (paymentsResult.error) {
    logger.error("Failed to export unapplied aging payments", {
      companyId,
      side,
      error: paymentsResult.error
    });
    throw new Response("Aging could not be exported.", { status: 500 });
  }
  const unappliedPayments: AgingCsvDocument[] = paymentsResult.data.map(
    (payment) => ({
      partyId: payment.partyId,
      documentNumber: payment.documentNumber,
      documentType: payment.documentType,
      transactionDate: payment.transactionDate,
      dateDue: null,
      originalInBase: payment.originalInBase,
      openInBase: payment.openInBase
    })
  );
  const ids = [
    ...new Set([
      ...aging.map((row) => row.partyId),
      ...open.map((row) => row.partyId),
      ...unappliedPayments.map((row) => row.partyId)
    ])
  ];
  const parties =
    side === "ar"
      ? await fetchAllByIds(ids, (chunk) =>
          partyClient
            .from("customer")
            .select("id, name")
            .eq("companyId", companyId)
            .in("id", chunk)
            .order("id")
        )
      : await fetchAllByIds(ids, (chunk) =>
          partyClient
            .from("supplier")
            .select("id, name")
            .eq("companyId", companyId)
            .in("id", chunk)
            .order("id")
        );
  if (parties.error) {
    logger.error("Failed to read parties for aging export", {
      companyId,
      side,
      error: parties.error
    });
    throw new Response("Aging could not be exported.", { status: 500 });
  }
  return {
    asOfDate,
    table: agingCsvTable({
      labels: await getAgingCsvLabels(
        request,
        side === "ar" ? "Customer" : "Supplier",
        bucketDays
      ),
      partyNameById: new Map(parties.data.map((row) => [row.id, row.name])),
      aging,
      open,
      unappliedPayments,
      asOfDate,
      agingMethod,
      bucketDays,
      withSupplierReference: side === "ap"
    })
  };
}

export function agingCsvResponse(
  filename: string,
  table: { fields: string[]; rows: unknown[][] }
) {
  return new Response(encodeCsvTable(table.fields, table.rows), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

export async function agingExcelResponse(
  filename: string,
  table: { fields: string[]; rows: unknown[][] },
  side: "ar" | "ap"
) {
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet(side === "ar" ? "AR Aging" : "AP Aging");
  sheet.addRow(table.fields);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, table.rows.length + 1), column: table.fields.length }
  };
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8E8E8" }
  };
  table.fields.forEach((field, index) => {
    sheet.getColumn(index + 1).width =
      index === 0 ? 28 : Math.max(14, Math.min(26, field.length + 2));
  });

  const dueDateColumn = side === "ap" ? 6 : 5;
  const originalAmountColumn = side === "ap" ? 7 : 6;
  const currentColumn = side === "ap" ? 10 : 9;
  const totalColumn = table.fields.length;
  const excelEpoch = parseDate("1899-12-30");
  for (const values of table.rows) {
    const row = sheet.addRow(values as ExcelJS.CellValue[]);
    for (const column of [3, dueDateColumn]) {
      const cell = row.getCell(column);
      if (typeof cell.value === "string" && cell.value) {
        cell.value = parseDate(cell.value).compare(excelEpoch);
        cell.numFmt = "yyyy-mm-dd";
      }
    }
    for (const column of [
      originalAmountColumn,
      ...Array.from(
        { length: table.fields.length - currentColumn + 1 },
        (_, index) => currentColumn + index
      )
    ]) {
      row.getCell(column).numFmt = "#,##0.00;[Red](#,##0.00)";
    }
    row.getCell(totalColumn).value = {
      formula: `SUM(${sheet.getColumn(currentColumn).letter}${row.number}:${sheet.getColumn(totalColumn - 1).letter}${row.number})`,
      result: Number(values[totalColumn - 1] ?? 0)
    };
  }

  const totals = sheet.addRow([]);
  totals.getCell(1).value = table.fields[totalColumn - 1];
  totals.font = { bold: true };
  totals.border = { top: { style: "thin" } };
  for (const column of [
    originalAmountColumn,
    ...Array.from(
      { length: totalColumn - currentColumn + 1 },
      (_, index) => currentColumn + index
    )
  ]) {
    const cell = totals.getCell(column);
    cell.numFmt = "#,##0.00;[Red](#,##0.00)";
    cell.value = table.rows.length
      ? {
          formula: `SUM(${sheet.getColumn(column).letter}2:${sheet.getColumn(column).letter}${totals.number - 1})`,
          result: table.rows.reduce(
            (sum, values) => sum + Number(values[column - 1] ?? 0),
            0
          )
        }
      : 0;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  // ExcelJS declares Buffer against a different Node type version; at runtime
  // its bytes are array-like and copy into the Fetch response body.
  return new Response(new Uint8Array(buffer as unknown as ArrayLike<number>), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
