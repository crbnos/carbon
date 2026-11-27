// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize, type Caller } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { CSV_CONTENT_TYPE, encodeCsvTable } from "@carbon/files/csv";
import { parseDate } from "@internationalized/date";
import ExcelJS from "exceljs";
import { z } from "zod";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.service";
import { decodeCursor } from "~/utils/cursor";
import {
  exportListRows,
  fetchListPage,
  getListDefinition,
  type ListPage
} from "~/utils/list-registry/index.server";

type InvoiceSide = "sales" | "purchase";
type ExportColumn = { key: string; label: string };
type ExportTable = {
  columns: ExportColumn[];
  rows: (string | number | boolean | null)[][];
};

const PAGE_SIZE = 500;
// Match the existing background CSV export's row ceiling.
const MAX_ROWS = 100_000;
const CUSTOM_FIELD_PREFIX = "customFields->>";

const commonKeys = [
  "invoiceId",
  "status",
  "glCodes",
  "balance",
  "dateIssued",
  "dateDue",
  "datePaid",
  "postingDate",
  "paymentTermName",
  "createdAt",
  "updatedAt"
];
const sideKeys: Record<InvoiceSide, string[]> = {
  sales: [
    "customerId",
    "invoiceCustomerId",
    "customerReference",
    "needsReview",
    "invoiceTotal"
  ],
  purchase: [
    "supplierId",
    "invoiceSupplierId",
    "supplierReference",
    "purchaseOrderReadableIds",
    "orderTotal"
  ]
};

const columnsSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(120),
      label: z.string().min(1).max(120)
    })
  )
  .min(1)
  .max(80);

function cellValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item != null)
      .map((item) =>
        typeof item === "object" ? JSON.stringify(item) : String(item)
      )
      .join("; ");
  }
  return JSON.stringify(value);
}

function readCell(row: Record<string, unknown>, key: string): unknown {
  if (!key.startsWith(CUSTOM_FIELD_PREFIX)) return row[key];
  const fields = row.customFields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return null;
  }
  return (fields as Record<string, unknown>)[
    key.slice(CUSTOM_FIELD_PREFIX.length)
  ];
}

async function requestedColumns(
  client: Caller["client"],
  companyId: string,
  side: InvoiceSide,
  params: URLSearchParams
): Promise<ExportColumn[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(params.get("columns") ?? "null");
  } catch {
    throw new Response("Invalid export columns", { status: 400 });
  }
  const parsed = columnsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Response("Invalid export columns", { status: 400 });
  }
  const allowed = new Set([...commonKeys, ...sideKeys[side]]);
  if (parsed.data.some(({ key }) => key.startsWith(CUSTOM_FIELD_PREFIX))) {
    const schemas = await getCustomFieldsSchemas(client, {
      companyId,
      table: side === "sales" ? "salesInvoice" : "purchaseInvoice"
    });
    if (schemas.error) throw schemas.error;
    for (const table of schemas.data ?? []) {
      if (!Array.isArray(table.fields)) continue;
      for (const field of table.fields) {
        if (
          field &&
          typeof field === "object" &&
          !Array.isArray(field) &&
          typeof field.id === "string"
        ) {
          allowed.add(`${CUSTOM_FIELD_PREFIX}${field.id}`);
        }
      }
    }
  }
  const keys = parsed.data.map(({ key }) => key);
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new Response("Invalid export columns", { status: 400 });
  }
  return parsed.data;
}

/** A direct, user-scoped download of the active invoice list and saved view. */
export async function loadInvoiceExportTable(
  request: Request,
  side: InvoiceSide
): Promise<ExportTable> {
  const list = getListDefinition(
    side === "sales" ? "sales-invoices" : "purchase-invoices"
  );
  if (!list) throw new Response("Invoice list unavailable", { status: 500 });
  const { client, companyId } = await authorize(request, list.gate);
  const params = new URL(request.url).searchParams;
  const columns = await requestedColumns(client, companyId, side, params);
  params.delete("columns");
  params.delete("after");
  params.delete("count");

  const rows: ExportTable["rows"] = [];
  let nextCursor: string | null = null;
  do {
    const page: ListPage<Record<string, unknown>> = await fetchListPage(
      list,
      client,
      companyId,
      params,
      {
        limit: PAGE_SIZE,
        cursor: decodeCursor(nextCursor)
      }
    );
    if (page.error) throw page.error;
    const enriched = await exportListRows(list, page.rows, {
      client,
      companyId
    });
    if (
      side === "purchase" &&
      columns.some(
        ({ key }) => key === "supplierId" || key === "invoiceSupplierId"
      )
    ) {
      const ids = [
        ...new Set(
          enriched.flatMap((row) =>
            [row.supplierId, row.invoiceSupplierId].filter(
              (id): id is string => typeof id === "string"
            )
          )
        )
      ];
      if (ids.length > 0) {
        const suppliers = await getCarbonServiceRole()
          .from("supplier")
          .select("id,name")
          .eq("companyId", companyId)
          .in("id", ids);
        if (suppliers.error) throw suppliers.error;
        const names = new Map(
          (suppliers.data ?? []).map(({ id, name }) => [id, name])
        );
        for (const row of enriched) {
          if (typeof row.supplierId === "string") {
            row.supplierId = names.get(row.supplierId) ?? row.supplierId;
          }
          if (typeof row.invoiceSupplierId === "string") {
            row.invoiceSupplierId =
              names.get(row.invoiceSupplierId) ?? row.invoiceSupplierId;
          }
        }
      }
    }
    for (const row of enriched) {
      rows.push(columns.map(({ key }) => cellValue(readCell(row, key))));
    }
    nextCursor = page.nextCursor;
    if (rows.length > MAX_ROWS || (nextCursor && rows.length === MAX_ROWS)) {
      throw new Response("Invoice export is too large", { status: 413 });
    }
  } while (nextCursor);
  return { columns, rows };
}

export function invoiceCsvResponse(filename: string, table: ExportTable) {
  return new Response(
    encodeCsvTable(
      table.columns.map(({ label }) => label),
      table.rows
    ),
    {
      headers: {
        "Content-Type": CSV_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    }
  );
}

export async function invoiceExcelResponse(
  filename: string,
  table: ExportTable,
  side: InvoiceSide
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(
    side === "sales" ? "Sales Invoices" : "Purchase Invoices"
  );
  sheet.addRow(table.columns.map(({ label }) => label));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(1, table.rows.length + 1),
      column: table.columns.length
    }
  };
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8E8E8" }
  };
  table.columns.forEach(({ key, label }, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = Math.max(14, Math.min(28, label.length + 2));
    if (["invoiceTotal", "orderTotal", "balance"].includes(key)) {
      column.numFmt = "#,##0.00;[Red](#,##0.00)";
    }
  });
  const dateKeys = new Set([
    "dateIssued",
    "dateDue",
    "datePaid",
    "postingDate"
  ]);
  const excelEpoch = parseDate("1899-12-30");
  for (const values of table.rows) {
    const row = sheet.addRow(values as ExcelJS.CellValue[]);
    table.columns.forEach(({ key }, index) => {
      const cell = row.getCell(index + 1);
      if (dateKeys.has(key) && typeof cell.value === "string" && cell.value) {
        cell.value = parseDate(cell.value).compare(excelEpoch);
        cell.numFmt = "yyyy-mm-dd";
      }
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
