import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import {
  insertQuote,
  upsertQuoteLine,
  upsertQuoteLinePrices
} from "./sales.service";

// App-side bulk quote importer. Unlike the master-data imports (which run in the
// `import-csv` Deno edge function with direct Kysely writes), quotes are created
// through the real sales services so their side effects — opportunity,
// quotePayment, quoteShipment, external portal link, sequence number — are
// preserved (see `.ai/specs/2026-07-28-quote-bulk-import.md`, Option B).
//
// Three modes, discriminated by the `table` arg:
//   - `quote`          header rows only (one quote per row)
//   - `quoteLine`      lines + pricing appended to existing quotes (by Quote Number)
//   - `quoteWithLines` combined: header + line rows grouped by Quote Group
//
// Idempotency is create-only: a Quote Group whose external id was already
// imported (recorded in `externalIntegrationMapping`, integration `csv`) is
// skipped rather than duplicated. Within a file, a repeated (Part Number,
// Quantity) line is skipped too.

const QUOTE_IMPORT_TABLES = ["quote", "quoteLine", "quoteWithLines"] as const;
export type QuoteImportTable = (typeof QUOTE_IMPORT_TABLES)[number];

export function isQuoteImportTable(table: string): table is QuoteImportTable {
  return (QUOTE_IMPORT_TABLES as readonly string[]).includes(table);
}

const EXTERNAL_INTEGRATION = "csv";
const QUOTE_ENTITY_TYPE = "quote";

const METHOD_TYPES = [
  "Purchase to Order",
  "Pull from Inventory",
  "Make to Order"
] as const;
type MethodType = (typeof METHOD_TYPES)[number];

const LINE_STATUSES = [
  "Not Started",
  "In Progress",
  "Complete",
  "No Quote"
] as const;
type LineStatus = (typeof LINE_STATUSES)[number];

const QUOTE_STATUSES = [
  "Draft",
  "Sent",
  "Ordered",
  "Partial",
  "Lost",
  "Cancelled",
  "Expired"
] as const;
type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// Legacy Buy/Pick/Make → current method-type names.
const LEGACY_METHOD_TYPE: Record<string, MethodType> = {
  buy: "Purchase to Order",
  pick: "Pull from Inventory",
  make: "Make to Order"
};

type Rec = Record<string, string>;
type RowIssue = { row: number; reason: string; values: Rec };
type Summary = {
  inserted: number;
  updated: number;
  errors: RowIssue[];
  skipped: RowIssue[];
};

type ImportQuotesArgs = {
  table: QuoteImportTable;
  filePath: string;
  columnMappings: Record<string, string>;
  enumMappings?: Record<string, Record<string, string>>;
  companyId: string;
  companyGroupId: string;
  userId: string;
};

type ImportQuotesResult = {
  data: Summary | null;
  error: { message: string } | null;
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

// PostgREST caps a single `.in(...)` list; chunk large id sets so a big file
// can't blow the request size limit.
const LOOKUP_CHUNK = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

const text = (value: string | null | undefined): string => (value ?? "").trim();

const num = (value: string | null | undefined): number | undefined => {
  const t = text(value);
  if (!t) return undefined;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

function normalizeMethodType(raw: string | undefined): MethodType | null {
  const t = text(raw);
  if (!t) return null;
  const lower = t.toLowerCase();
  if (LEGACY_METHOD_TYPE[lower]) return LEGACY_METHOD_TYPE[lower];
  const match = METHOD_TYPES.find((m) => m.toLowerCase() === lower);
  return match ?? null;
}

function normalizeLineStatus(raw: string | undefined): LineStatus {
  const t = text(raw).toLowerCase();
  return LINE_STATUSES.find((s) => s.toLowerCase() === t) ?? "Not Started";
}

function normalizeQuoteStatus(
  raw: string | undefined
): QuoteStatus | undefined {
  const t = text(raw).toLowerCase();
  return QUOTE_STATUSES.find((s) => s.toLowerCase() === t);
}

// discountPercent is stored as a fraction 0..1. To remove the ambiguity at 1
// (100% or 1%?), the format decides: a decimal-formatted value (contains ".") is
// a fraction and must be 0..1; a whole number is a percent and must be 0..100
// (e.g. "0.10" → 0.10, "10" → 0.10, "1" → 0.01). Reject out-of-range / negative.
function normalizeDiscount(raw: string | undefined): number | "invalid" {
  const t = text(raw);
  if (!t) return 0;
  const n = num(t);
  if (n === undefined || n < 0) return "invalid";
  if (t.includes(".")) return n <= 1 ? n : "invalid";
  return n <= 100 ? n / 100 : "invalid";
}

type RowType = "QUOTE" | "LINE";

function resolveRowType(record: Rec, table: QuoteImportTable): RowType {
  if (table === "quote") return "QUOTE";
  if (table === "quoteLine") return "LINE";
  const explicit = text(record.rowType).toUpperCase();
  if (explicit === "QUOTE") return "QUOTE";
  if (explicit === "LINE") return "LINE";
  // Blank Row Type: a Part Number means it's a line, otherwise a header.
  return text(record.itemReadableId) ? "LINE" : "QUOTE";
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export async function importQuotes(
  client: SupabaseClient<Database>,
  args: ImportQuotesArgs
): Promise<ImportQuotesResult> {
  const { table, filePath, columnMappings, companyId, companyGroupId, userId } =
    args;

  const summary: Summary = {
    inserted: 0,
    updated: 0,
    errors: [],
    skipped: []
  };

  // 1. download + parse ----------------------------------------------------
  const download = await client.storage.from("private").download(filePath);
  if (download.error || !download.data) {
    return {
      data: null,
      error: { message: download.error?.message ?? "Failed to download file" }
    };
  }

  const csvText = await download.data.text();
  const parsed = Papa.parse<Rec>(csvText, {
    header: true,
    skipEmptyLines: true
  });
  const rawRows = parsed.data ?? [];

  // 2. apply column (and any enum) mappings → per-field records ------------
  const records: Rec[] = rawRows.map((raw) => {
    const mapped: Rec = {};
    for (const [field, header] of Object.entries(columnMappings)) {
      if (!header || header === "N/A") continue;
      const value = text(raw[header]);
      const enumMap = args.enumMappings?.[field];
      mapped[field] = enumMap
        ? (enumMap[value] ?? enumMap.Default ?? value)
        : value;
    }
    return mapped;
  });

  if (records.length === 0) {
    return { data: summary, error: null };
  }

  // 3. batch-resolve references (customers, items, existing quotes) --------
  const { refs, error: refError } = await loadReferences(
    client,
    companyId,
    records,
    table
  );
  if (refError || !refs) {
    return {
      data: null,
      error: refError ?? { message: "Failed to load import references" }
    };
  }

  // 4. process by mode -----------------------------------------------------
  if (table === "quoteLine") {
    await importLinesIntoExistingQuotes(client, {
      records,
      refs,
      companyId,
      userId,
      summary
    });
  } else {
    await importQuoteGroups(client, {
      table,
      records,
      refs,
      companyId,
      companyGroupId,
      userId,
      summary
    });
  }

  return { data: summary, error: null };
}

// ---------------------------------------------------------------------------
// reference resolution
// ---------------------------------------------------------------------------

type ItemInfo = {
  id: string;
  readableId: string;
  type: string;
  defaultMethodType: string | null;
  unitOfMeasureCode: string | null;
};

type References = {
  customersByKey: Map<string, string>; // lowercased name|readableId → customer.id
  ambiguousCustomers: Set<string>;
  itemsByReadableId: Map<string, ItemInfo>; // exact readableId → item
  quotesByNumber: Map<string, string>; // Quote Number → quote.id
  importedExternalIds: Set<string>;
};

// Resolves every reference the import needs up front. Any DB read failing is a
// hard error (returned, not swallowed) so a lookup failure never masquerades as
// a row-level "not found".
async function loadReferences(
  client: SupabaseClient<Database>,
  companyId: string,
  records: Rec[],
  table: QuoteImportTable
): Promise<{ refs: References | null; error: { message: string } | null }> {
  const refs: References = {
    customersByKey: new Map(),
    ambiguousCustomers: new Set(),
    itemsByReadableId: new Map(),
    quotesByNumber: new Map(),
    importedExternalIds: new Set()
  };

  // Customers — resolve by name or readableId (only for header rows). Name
  // matching is case-insensitive, so fetch all company customers (paged past the
  // 1000-row cap) and compare in memory.
  const hasCustomerKey = records.some((r) => text(r.customerId));
  if (hasCustomerKey && table !== "quoteLine") {
    try {
      const customers = await fetchAllFromTable<{
        id: string;
        name: string | null;
        readableId: string | null;
      }>(client, "customer", "id, name, readableId", (q) =>
        q.eq("companyId", companyId)
      );
      for (const c of customers.data ?? []) {
        for (const raw of [c.name, c.readableId]) {
          const k = text(raw).toLowerCase();
          if (!k) continue;
          if (
            refs.customersByKey.has(k) &&
            refs.customersByKey.get(k) !== c.id
          ) {
            refs.ambiguousCustomers.add(k);
          } else {
            refs.customersByKey.set(k, c.id);
          }
        }
      }
    } catch (err) {
      return {
        refs: null,
        error: {
          message: `Failed to load customers: ${(err as Error).message}`
        }
      };
    }
  }

  // Items — resolve part numbers (exact readableId match), chunked.
  const partNumbers = new Set<string>();
  for (const r of records) {
    const pn = text(r.itemReadableId);
    if (pn) partNumbers.add(pn);
  }
  for (const batch of chunk(Array.from(partNumbers), LOOKUP_CHUNK)) {
    const items = await client
      .from("item")
      .select("id, readableId, type, defaultMethodType, unitOfMeasureCode")
      .eq("companyId", companyId)
      .in("readableId", batch);
    if (items.error) {
      return {
        refs: null,
        error: { message: `Failed to load items: ${items.error.message}` }
      };
    }
    for (const it of items.data ?? []) {
      refs.itemsByReadableId.set(text(it.readableId), {
        id: it.id,
        readableId: it.readableId,
        type: it.type ?? "Part",
        defaultMethodType: it.defaultMethodType ?? null,
        unitOfMeasureCode: it.unitOfMeasureCode ?? null
      });
    }
  }

  // Existing quotes — needed only when appending lines by Quote Number.
  if (table === "quoteLine") {
    const numbers = new Set<string>();
    for (const r of records) {
      const q = text(r.quoteId);
      if (q) numbers.add(q);
    }
    for (const batch of chunk(Array.from(numbers), LOOKUP_CHUNK)) {
      const quotes = await client
        .from("quote")
        .select("id, quoteId")
        .eq("companyId", companyId)
        .in("quoteId", batch);
      if (quotes.error) {
        return {
          refs: null,
          error: { message: `Failed to load quotes: ${quotes.error.message}` }
        };
      }
      for (const q of quotes.data ?? []) {
        refs.quotesByNumber.set(text(q.quoteId), q.id);
      }
    }
  }

  // Already-imported Quote Groups (create-only idempotency) — query only the
  // external ids present in this file, chunked, so a company with many prior
  // imports can't overflow the 1000-row cap and miss an existing mapping.
  if (table !== "quoteLine") {
    const externalIds = new Set<string>();
    for (const r of records) {
      const e = text(r.externalId);
      if (e) externalIds.add(e);
    }
    for (const batch of chunk(Array.from(externalIds), LOOKUP_CHUNK)) {
      const mappings = await client
        .from("externalIntegrationMapping")
        .select("externalId")
        .eq("companyId", companyId)
        .eq("integration", EXTERNAL_INTEGRATION)
        .eq("entityType", QUOTE_ENTITY_TYPE)
        .in("externalId", batch);
      if (mappings.error) {
        return {
          refs: null,
          error: {
            message: `Failed to load import history: ${mappings.error.message}`
          }
        };
      }
      for (const m of mappings.data ?? []) {
        const k = text(m.externalId);
        if (k) refs.importedExternalIds.add(k);
      }
    }
  }

  return { refs, error: null };
}

// ---------------------------------------------------------------------------
// mode: quote / quoteWithLines (grouped by Quote Group)
// ---------------------------------------------------------------------------

type Entry = { record: Rec; index: number };

async function importQuoteGroups(
  client: SupabaseClient<Database>,
  ctx: {
    table: QuoteImportTable;
    records: Rec[];
    refs: References;
    companyId: string;
    companyGroupId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { table, records, refs, companyId, companyGroupId, userId, summary } =
    ctx;

  // Group rows by Quote Group (externalId), preserving order.
  const groups = new Map<
    string,
    { headers: Entry[]; lines: Entry[]; firstIndex: number }
  >();
  const groupOrder: string[] = [];

  records.forEach((record, index) => {
    const externalId = text(record.externalId);
    const rowType = resolveRowType(record, table);

    if (!externalId) {
      summary.errors.push({
        row: index,
        reason: "Quote Group is required",
        values: record
      });
      return;
    }

    if (!groups.has(externalId)) {
      groups.set(externalId, { headers: [], lines: [], firstIndex: index });
      groupOrder.push(externalId);
    }
    const group = groups.get(externalId)!;
    if (rowType === "QUOTE") group.headers.push({ record, index });
    else group.lines.push({ record, index });
  });

  for (const externalId of groupOrder) {
    const group = groups.get(externalId)!;

    // Create-only idempotency: skip a Quote Group already imported.
    if (refs.importedExternalIds.has(externalId)) {
      for (const entry of [...group.headers, ...group.lines]) {
        summary.skipped.push({
          row: entry.index,
          reason: `Quote Group "${externalId}" was already imported`,
          values: entry.record
        });
      }
      continue;
    }

    const header = group.headers[0];
    if (!header) {
      // Lines with no header row in the file (combined mode only).
      for (const entry of group.lines) {
        summary.errors.push({
          row: entry.index,
          reason: `No header (QUOTE) row for Quote Group "${externalId}"`,
          values: entry.record
        });
      }
      continue;
    }

    // Extra header rows for the same group are duplicates.
    for (const dup of group.headers.slice(1)) {
      summary.skipped.push({
        row: dup.index,
        reason: `Duplicate header for Quote Group "${externalId}"`,
        values: dup.record
      });
    }

    // Resolve + create the header.
    const customerKey = text(header.record.customerId).toLowerCase();
    if (!customerKey) {
      summary.errors.push({
        row: header.index,
        reason: "Customer is required",
        values: header.record
      });
      failLines(group.lines, "Parent quote could not be created", summary);
      continue;
    }
    if (refs.ambiguousCustomers.has(customerKey)) {
      summary.errors.push({
        row: header.index,
        reason: `Customer "${text(header.record.customerId)}" is ambiguous`,
        values: header.record
      });
      failLines(group.lines, "Parent quote could not be created", summary);
      continue;
    }
    const customerId = refs.customersByKey.get(customerKey);
    if (!customerId) {
      summary.errors.push({
        row: header.index,
        reason: `Customer "${text(header.record.customerId)}" not found`,
        values: header.record
      });
      failLines(group.lines, "Parent quote could not be created", summary);
      continue;
    }

    const created = await insertQuote(client, {
      customerId,
      companyId,
      companyGroupId,
      createdBy: userId,
      customerReference: text(header.record.customerReference) || undefined,
      expirationDate: text(header.record.expirationDate) || undefined,
      dueDate: text(header.record.dueDate) || undefined,
      status: normalizeQuoteStatus(header.record.quoteStatus)
    });

    if (created.error || !created.data) {
      summary.errors.push({
        row: header.index,
        reason: created.error?.message ?? "Failed to create quote",
        values: header.record
      });
      failLines(group.lines, "Parent quote could not be created", summary);
      continue;
    }

    summary.inserted += 1;
    const quoteInternalId = created.data.id;

    // Record the mapping so a re-import skips this Quote Group. If this write
    // fails the quote still exists, so surface it — a re-import would otherwise
    // create a duplicate quote for this group.
    const mappingInsert = await client
      .from("externalIntegrationMapping")
      .insert({
        entityType: QUOTE_ENTITY_TYPE,
        entityId: quoteInternalId,
        integration: EXTERNAL_INTEGRATION,
        externalId,
        companyId,
        createdBy: userId
      });
    if (mappingInsert.error) {
      summary.errors.push({
        row: header.index,
        reason: `Quote created, but recording its import mapping failed (a re-import may duplicate it): ${mappingInsert.error.message}`,
        values: header.record
      });
    }

    await createLines(client, {
      quoteInternalId,
      lines: group.lines,
      refs,
      companyId,
      userId,
      summary
    });
  }
}

// ---------------------------------------------------------------------------
// mode: quoteLine (append to existing quotes by Quote Number)
// ---------------------------------------------------------------------------

async function importLinesIntoExistingQuotes(
  client: SupabaseClient<Database>,
  ctx: {
    records: Rec[];
    refs: References;
    companyId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { records, refs, companyId, userId, summary } = ctx;

  const byQuote = new Map<string, Entry[]>();
  records.forEach((record, index) => {
    const quoteNumber = text(record.quoteId);
    if (!quoteNumber) {
      summary.errors.push({
        row: index,
        reason: "Quote Number is required",
        values: record
      });
      return;
    }
    if (!byQuote.has(quoteNumber)) byQuote.set(quoteNumber, []);
    byQuote.get(quoteNumber)!.push({ record, index });
  });

  for (const [quoteNumber, lines] of byQuote) {
    const quoteInternalId = refs.quotesByNumber.get(quoteNumber);
    if (!quoteInternalId) {
      failLines(lines, `Quote "${quoteNumber}" not found`, summary);
      continue;
    }
    await createLines(client, {
      quoteInternalId,
      lines,
      refs,
      companyId,
      userId,
      summary
    });
  }
}

// ---------------------------------------------------------------------------
// shared line creation (+ in-file dedup + explicit pricing)
// ---------------------------------------------------------------------------

async function createLines(
  client: SupabaseClient<Database>,
  ctx: {
    quoteInternalId: string;
    lines: Entry[];
    refs: References;
    companyId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { quoteInternalId, lines, refs, companyId, userId, summary } = ctx;
  const seen = new Set<string>(); // `${partNumber}|${quantity}` within this quote

  for (const { record, index } of lines) {
    const partNumber = text(record.itemReadableId);
    if (!partNumber) {
      summary.errors.push({
        row: index,
        reason: "Part Number is required",
        values: record
      });
      continue;
    }
    const item = refs.itemsByReadableId.get(partNumber);
    if (!item) {
      summary.errors.push({
        row: index,
        reason: `Part "${partNumber}" not found`,
        values: record
      });
      continue;
    }

    const description = text(record.description) || item.readableId;
    const quantityRaw = text(record.quantity);
    if (!quantityRaw) {
      summary.errors.push({
        row: index,
        reason: "Quantity is required",
        values: record
      });
      continue;
    }
    const quantity = num(quantityRaw);
    if (quantity === undefined || quantity < 0.00001) {
      summary.errors.push({
        row: index,
        reason: "Quantity must be a positive number",
        values: record
      });
      continue;
    }

    const dedupKey = `${item.readableId}|${quantity}`;
    if (seen.has(dedupKey)) {
      summary.skipped.push({
        row: index,
        reason: `Duplicate line (${partNumber} @ qty ${quantity})`,
        values: record
      });
      continue;
    }
    seen.add(dedupKey);

    const discount = normalizeDiscount(record.discountPercent);
    if (discount === "invalid") {
      summary.errors.push({
        row: index,
        reason:
          "Discount Percent must be a fraction 0–1 (e.g. 0.10) or a whole percent 0–100 (e.g. 10)",
        values: record
      });
      continue;
    }

    const methodType =
      normalizeMethodType(record.methodType) ??
      normalizeMethodType(item.defaultMethodType ?? undefined) ??
      "Pull from Inventory";

    const unitOfMeasureCode =
      text(record.unitOfMeasureCode) || item.unitOfMeasureCode || "EA";

    const linePayload = {
      quoteId: quoteInternalId,
      itemId: item.id,
      itemReadableId: item.readableId,
      itemType: item.type,
      description,
      methodType,
      unitOfMeasureCode,
      status: normalizeLineStatus(record.lineStatus),
      quantity: [quantity],
      taxPercent: 0,
      customerPartId: text(record.customerPartId) || undefined,
      companyId,
      createdBy: userId
    };

    const line = await upsertQuoteLine(
      client,
      linePayload as Parameters<typeof upsertQuoteLine>[1]
    );

    if (line.error || !line.data) {
      summary.errors.push({
        row: index,
        reason: line.error?.message ?? "Failed to create quote line",
        values: record
      });
      continue;
    }

    summary.inserted += 1;
    const lineId = line.data.id;

    // Explicit quantity-break pricing. Only persist non-negative, valid numbers
    // — a present-but-invalid or negative Unit Price / Lead Time is rejected
    // rather than written to the quote line.
    const unitPriceRaw = text(record.unitPrice);
    if (unitPriceRaw) {
      const unitPrice = num(unitPriceRaw);
      const leadTimeRaw = text(record.leadTime);
      const leadTime = num(leadTimeRaw);

      if (unitPrice === undefined || unitPrice < 0) {
        summary.errors.push({
          row: index,
          reason: "Unit Price must be a number of 0 or greater",
          values: record
        });
      } else if (leadTimeRaw && (leadTime === undefined || leadTime < 0)) {
        summary.errors.push({
          row: index,
          reason: "Lead Time must be a number of 0 or greater",
          values: record
        });
      } else {
        const priceResult = await upsertQuoteLinePrices(
          client,
          quoteInternalId,
          lineId,
          [
            {
              quoteLineId: lineId,
              unitPrice,
              leadTime: leadTime ?? 0,
              discountPercent: discount,
              quantity,
              createdBy: userId,
              priceSource: "manual"
            }
          ]
        );
        if (priceResult.error) {
          summary.errors.push({
            row: index,
            reason: `Line created but pricing failed: ${priceResult.error.message}`,
            values: record
          });
        }
      }
    }
  }
}

function failLines(lines: Entry[], reason: string, summary: Summary): void {
  for (const { record, index } of lines) {
    summary.errors.push({ row: index, reason, values: record });
  }
}
