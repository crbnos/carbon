import { openai } from "@ai-sdk/openai";
import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  insertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import { insertSalesOrder, upsertSalesOrderLine } from "~/modules/sales";

// Open orders — the switch-week importer. A factory switching to Carbon still
// carries open purchase orders (material on the way) and open customer orders
// (work it owes). The customer pastes or uploads whatever export their old
// system produces; the AI extracts order headers + lines; we match suppliers/
// customers/items deterministically; the customer reviews the proposal; and
// applying it creates DRAFT orders through the existing purchasing/sales
// services. Drafts only — nothing is released, sent, or received from here.

const logger = getLogger("erp", "open-orders");

export type OpenOrderKind = "po" | "so";

// Bounded extraction: a switch-week order book, not a full history. Larger
// factories import in batches.
export const MAX_OPEN_ORDERS = 40;
export const MAX_OPEN_ORDER_LINES = 40;

/** Character budget for the AI prompt source (mirrors opening-stock). */
const MAX_SOURCE_CHARS = 48000;
const MAX_SOURCE_ROWS = 1000;

// ---------------------------------------------------------------------------
// Upload reading — CSV/TSV/TXT/XLSX only (no photos here; order exports are
// tabular or text). Returns bounded CSV-ish text or null when unreadable.
// ---------------------------------------------------------------------------

export async function readOpenOrdersUpload(
  client: SupabaseClient<Database>,
  args: { uploadPath: string; uploadName: string }
): Promise<string | null> {
  try {
    const download = await client.storage
      .from("private")
      .download(args.uploadPath);
    if (download.error || !download.data) {
      if (download.error) {
        logger.error("Failed to download open orders upload", {
          error: download.error
        });
      }
      return null;
    }

    const extension =
      (args.uploadName || args.uploadPath).split(".").pop()?.toLowerCase() ??
      "";

    let text: string | null = null;
    if (["csv", "tsv", "txt"].includes(extension)) {
      text = await download.data.text();
    } else if (["xlsx", "xls"].includes(extension)) {
      const buffer = await download.data.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) return null;
      text = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    } else {
      return null;
    }

    if (!text?.trim()) return null;

    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const rows = (parsed.data ?? []).filter(
      (row) =>
        Array.isArray(row) &&
        row.some((cell) => String(cell ?? "").trim() !== "")
    );
    if (rows.length === 0) return null;

    const sample = rows
      .slice(0, MAX_SOURCE_ROWS)
      .map((row) =>
        row.slice(0, 24).map((cell) => String(cell ?? "").slice(0, 200))
      );
    const csv = Papa.unparse(sample);
    return csv.length > MAX_SOURCE_CHARS ? csv.slice(0, MAX_SOURCE_CHARS) : csv;
  } catch (err) {
    logger.error("Failed to read open orders upload", { error: err });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const extractedLineSchema = z.object({
  partNumber: z.string().max(120).optional(),
  description: z.string().max(300).optional(),
  quantity: z.number().min(0),
  unitPrice: z.number().min(0).optional()
});

const poExtractionSchema = z.object({
  orders: z
    .array(
      z.object({
        reference: z.string().max(120).optional(),
        supplierName: z.string().min(1).max(200),
        orderDate: z.string().max(20).optional(),
        expectedDate: z.string().max(20).optional(),
        lines: z.array(extractedLineSchema).max(MAX_OPEN_ORDER_LINES)
      })
    )
    .max(MAX_OPEN_ORDERS)
});

const soExtractionSchema = z.object({
  orders: z
    .array(
      z.object({
        reference: z.string().max(120).optional(),
        customerName: z.string().min(1).max(200),
        orderDate: z.string().max(20).optional(),
        dueDate: z.string().max(20).optional(),
        lines: z.array(extractedLineSchema).max(MAX_OPEN_ORDER_LINES)
      })
    )
    .max(MAX_OPEN_ORDERS)
});

export type ExtractedOpenOrderLine = {
  partNumber: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
};

export type ExtractedOpenOrder = {
  reference: string | null;
  /** Supplier name (po) or customer name (so), exactly as written. */
  partyName: string;
  orderDate: string | null;
  /** Expected receipt date (po) or due date (so). */
  neededBy: string | null;
  lines: ExtractedOpenOrderLine[];
};

const SHARED_RULES = `
Rules:
- One output order per order in the source; group its lines under it. When the source is a flat line-level export, group lines by their order number.
- reference is the order number exactly as written (e.g. "PO-1042" / "SO-2210"); omit it when the source has none.
- Dates are ISO format (YYYY-MM-DD). Omit any date that is not in the source — never invent or infer dates.
- Each line: partNumber is the item / part / SKU number when shown; description is the line's description when shown; quantity is the line quantity; unitPrice is the per-unit price when shown.
- Never invent values; omit what isn't in the source. Skip lines whose quantity is missing or unreadable. Do not compute totals or fill in prices that are not written.
`;

const PO_SYSTEM = `You transcribe a factory's OPEN PURCHASE ORDERS — orders still outstanding with suppliers — from whatever export or notes they paste or upload.
Return ONLY the JSON object matching the schema.
${SHARED_RULES}
- supplierName is the supplier / vendor the order was placed with, exactly as written.
- orderDate is when the order was placed; expectedDate is when the material is expected to arrive (due/promised/dock date).
- When the source distinguishes ordered vs received quantities, quantity is the OUTSTANDING (still open) quantity; otherwise the ordered quantity.`;

const SO_SYSTEM = `You transcribe a factory's OPEN CUSTOMER ORDERS — sales orders it still owes customers — from whatever export or notes they paste or upload.
Return ONLY the JSON object matching the schema.
${SHARED_RULES}
- customerName is the customer the order is for, exactly as written.
- orderDate is when the order was placed; dueDate is when the order is due to ship (promise/ship-by date).
- When the source distinguishes ordered vs shipped quantities, quantity is the OUTSTANDING (still open) quantity; otherwise the ordered quantity.`;

const isoDate = (value: string | null | undefined): string | null =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;

/** Extract open orders from bounded source text. Returns null when the AI
 * fails — the caller reports it plainly, never guesses. */
export async function extractOpenOrders(args: {
  kind: OpenOrderKind;
  source: string;
}): Promise<ExtractedOpenOrder[] | null> {
  const source = args.source.slice(0, MAX_SOURCE_CHARS);

  try {
    if (args.kind === "po") {
      const { object } = await generateObject({
        model: openai("gpt-4o"),
        schema: poExtractionSchema,
        system: PO_SYSTEM,
        prompt: `Source:\n\n${source}`,
        temperature: 0
      });
      return object.orders.map((order) => ({
        reference: order.reference?.trim() || null,
        partyName: order.supplierName.trim(),
        orderDate: isoDate(order.orderDate),
        neededBy: isoDate(order.expectedDate),
        lines: normalizeLines(order.lines)
      }));
    }

    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: soExtractionSchema,
      system: SO_SYSTEM,
      prompt: `Source:\n\n${source}`,
      temperature: 0
    });
    return object.orders.map((order) => ({
      reference: order.reference?.trim() || null,
      partyName: order.customerName.trim(),
      orderDate: isoDate(order.orderDate),
      neededBy: isoDate(order.dueDate),
      lines: normalizeLines(order.lines)
    }));
  } catch (err) {
    logger.error("Open orders AI extraction failed", { error: err });
    return null;
  }
}

function normalizeLines(
  lines: z.infer<typeof extractedLineSchema>[]
): ExtractedOpenOrderLine[] {
  return lines
    .map((line) => ({
      partNumber: line.partNumber?.trim() || null,
      description: line.description?.trim() || null,
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? null
    }))
    .filter(
      (line) =>
        line.quantity > 0 &&
        (line.partNumber !== null || line.description !== null)
    );
}

// ---------------------------------------------------------------------------
// Matching — deterministic, exact case-insensitive matches only. Suppliers/
// customers by name or readableId; items by readableId (with or without
// revision) then name. Anything unmatched or ambiguous is reported honestly,
// NEVER auto-created and never guessed.
// ---------------------------------------------------------------------------

export type OpenOrderLineProposal = {
  partNumber: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  itemId: string | null;
  itemReadableId: string | null;
  itemName: string | null;
  /** matched → a typed item line; comment → SO description-only line;
   * skipped → left off the draft (PO lines have no comment type here). */
  reason: "matched" | "comment" | "skipped";
  detail: "noItem" | "ambiguousItem" | "unsupportedType" | null;
};

export type OpenOrderProposalOrder = {
  reference: string | null;
  partyName: string;
  partyId: string | null;
  partyMatchedName: string | null;
  partyDetail: "noParty" | "ambiguousParty" | null;
  orderDate: string | null;
  neededBy: string | null;
  lines: OpenOrderLineProposal[];
  /** Sum over priced lines only; null when no line has a price. */
  total: number | null;
  totalIsPartial: boolean;
};

export type OpenOrdersProposal = {
  kind: OpenOrderKind;
  orders: OpenOrderProposalOrder[];
};

type PartyForMatch = {
  id: string;
  name: string | null;
  readableId: string | null;
};

type ItemForMatch = {
  id: string;
  readableId: string | null;
  readableIdWithRevision: string | null;
  name: string | null;
  type: Database["public"]["Enums"]["itemType"];
};

const normalize = (value: string) => value.trim().toLowerCase();

function addToKeyMap<T extends { id: string }>(
  map: Map<string, T[]>,
  key: string | null,
  row: T
) {
  const normalized = key ? normalize(key) : "";
  if (!normalized) return;
  const bucket = map.get(normalized);
  if (bucket) {
    if (!bucket.some((existing) => existing.id === row.id)) bucket.push(row);
  } else {
    map.set(normalized, [row]);
  }
}

/** Exactly-one lookup: a key that resolves to more than one distinct record is
 * ambiguous — reported, never guessed. */
function lookupOne<T extends { id: string }>(
  map: Map<string, T[]>,
  key: string | null
): { match: T | null; ambiguous: boolean } {
  if (!key) return { match: null, ambiguous: false };
  const bucket = map.get(normalize(key));
  if (!bucket || bucket.length === 0) return { match: null, ambiguous: false };
  if (bucket.length > 1) return { match: null, ambiguous: true };
  return { match: bucket[0]!, ambiguous: false };
}

export async function matchOpenOrders(
  client: SupabaseClient<Database>,
  args: { kind: OpenOrderKind; companyId: string; orders: ExtractedOpenOrder[] }
): Promise<OpenOrdersProposal | null> {
  const { kind, companyId, orders } = args;

  const [parties, items] = await Promise.all([
    fetchAllFromTable<PartyForMatch>(
      client,
      kind === "po" ? "supplier" : "customer",
      "id, name, readableId",
      (query) => query.eq("companyId", companyId)
    ),
    fetchAllFromTable<ItemForMatch>(
      client,
      "item",
      "id, readableId, readableIdWithRevision, name, type",
      (query) => query.eq("companyId", companyId).eq("active", true)
    )
  ]);

  if (parties.error || !parties.data || items.error || !items.data) {
    logger.error("Failed to load matching data for open orders", {
      error: parties.error ?? items.error
    });
    return null;
  }

  const partiesByKey = new Map<string, PartyForMatch[]>();
  for (const party of parties.data) {
    addToKeyMap(partiesByKey, party.name, party);
    addToKeyMap(partiesByKey, party.readableId, party);
  }

  const itemsByCode = new Map<string, ItemForMatch[]>();
  const itemsByName = new Map<string, ItemForMatch[]>();
  for (const item of items.data) {
    addToKeyMap(itemsByCode, item.readableId, item);
    addToKeyMap(itemsByCode, item.readableIdWithRevision, item);
    addToKeyMap(itemsByName, item.name, item);
  }

  // readableId then name; part number then description.
  const lookupItem = (line: ExtractedOpenOrderLine) => {
    for (const key of [line.partNumber, line.description]) {
      if (!key) continue;
      const byCode = lookupOne(itemsByCode, key);
      if (byCode.match || byCode.ambiguous) return byCode;
      const byName = lookupOne(itemsByName, key);
      if (byName.match || byName.ambiguous) return byName;
    }
    return { match: null, ambiguous: false };
  };

  const proposalOrders: OpenOrderProposalOrder[] = orders.map((order) => {
    const party = lookupOne(partiesByKey, order.partyName);

    const lines: OpenOrderLineProposal[] = order.lines.map((line) => {
      const { match, ambiguous } = lookupItem(line);

      // Fixture items can't go on a sales order line (the sales order line
      // validator has no Fixture type) — degrade to a comment line.
      const unsupported = kind === "so" && match?.type === "Fixture";

      if (match && !unsupported) {
        return {
          partNumber: line.partNumber,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          itemId: match.id,
          itemReadableId: match.readableIdWithRevision ?? match.readableId,
          itemName: match.name,
          reason: "matched" as const,
          detail: null
        };
      }

      return {
        partNumber: line.partNumber,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        itemId: null,
        itemReadableId: null,
        itemName: null,
        // SO drafts keep the line as a description-only comment line; PO
        // drafts have no comment line type in the app, so the line is skipped.
        reason: kind === "so" ? ("comment" as const) : ("skipped" as const),
        detail: unsupported
          ? ("unsupportedType" as const)
          : ambiguous
            ? ("ambiguousItem" as const)
            : ("noItem" as const)
      };
    });

    const pricedLines = lines.filter((line) => line.unitPrice !== null);
    const total =
      pricedLines.length > 0
        ? pricedLines.reduce(
            (sum, line) => sum + line.quantity * (line.unitPrice ?? 0),
            0
          )
        : null;

    return {
      reference: order.reference,
      partyName: order.partyName,
      partyId: party.match?.id ?? null,
      partyMatchedName: party.match?.name ?? null,
      partyDetail: party.match
        ? null
        : party.ambiguous
          ? ("ambiguousParty" as const)
          : ("noParty" as const),
      orderDate: order.orderDate,
      neededBy: order.neededBy,
      lines,
      total,
      totalIsPartial: total !== null && pricedLines.length < lines.length
    };
  });

  return { kind, orders: proposalOrders };
}

// ---------------------------------------------------------------------------
// Apply — create DRAFT orders through the existing services, sequentially,
// with a per-order try/catch so one failure never kills the batch. The
// client-reviewed proposal is re-verified against the company's own data
// before anything is written (party + items re-fetched scoped by companyId).
// ---------------------------------------------------------------------------

export const appliedOpenOrdersSchema = z
  .array(
    z.object({
      reference: z.string().max(120).nullable(),
      partyName: z.string().min(1).max(200),
      partyId: z.string().min(1),
      orderDate: z.string().max(20).nullable(),
      neededBy: z.string().max(20).nullable(),
      lines: z
        .array(
          z.object({
            itemId: z.string().nullable(),
            partNumber: z.string().max(120).nullable(),
            description: z.string().max(300).nullable(),
            quantity: z.number().min(0),
            unitPrice: z.number().min(0).nullable()
          })
        )
        .max(MAX_OPEN_ORDER_LINES)
    })
  )
  .max(MAX_OPEN_ORDERS);

export type AppliedOpenOrders = z.infer<typeof appliedOpenOrdersSchema>;

export type OpenOrderApplyOutcome = {
  reference: string | null;
  partyName: string;
  orderId: string | null;
  readableId: string | null;
  linesCreated: number;
  commentLines: number;
  linesSkipped: number;
  linesFailed: number;
  error: "partyNotFound" | "createFailed" | null;
};

type ItemForApply = {
  id: string;
  name: string | null;
  type: Database["public"]["Enums"]["itemType"];
  unitOfMeasureCode: string | null;
  defaultMethodType: Database["public"]["Enums"]["methodType"] | null;
};

export async function applyOpenOrders(
  client: SupabaseClient<Database>,
  args: {
    kind: OpenOrderKind;
    companyId: string;
    companyGroupId: string;
    userId: string;
    /** Required for sales orders (the order + its lines need a location). */
    locationId: string | null;
    orders: AppliedOpenOrders;
  }
): Promise<OpenOrderApplyOutcome[]> {
  const { kind, companyId, companyGroupId, userId, locationId, orders } = args;

  const partyIds = [...new Set(orders.map((order) => order.partyId))];
  const itemIds = [
    ...new Set(
      orders.flatMap((order) =>
        order.lines.flatMap((line) => (line.itemId ? [line.itemId] : []))
      )
    )
  ];

  // Re-verify everything the client sent against this company's data —
  // the proposal JSON is client-held state, not a trusted input.
  const [partiesResult, itemsResult, replenishmentResult] = await Promise.all([
    client
      .from(kind === "po" ? "supplier" : "customer")
      .select("id, taxPercent")
      .in("id", partyIds.length > 0 ? partyIds : [""])
      .eq("companyId", companyId),
    client
      .from("item")
      .select("id, name, type, unitOfMeasureCode, defaultMethodType")
      .in("id", itemIds.length > 0 ? itemIds : [""])
      .eq("companyId", companyId),
    kind === "po" && itemIds.length > 0
      ? client
          .from("itemReplenishment")
          .select("itemId, purchasingUnitOfMeasureCode, conversionFactor")
          .in("itemId", itemIds)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [], error: null })
  ]);

  const partyById = new Map(
    (partiesResult.data ?? []).map((party) => [party.id, party])
  );
  const itemById = new Map<string, ItemForApply>(
    (itemsResult.data ?? []).map((item) => [item.id, item])
  );
  const replenishmentByItemId = new Map(
    (replenishmentResult.data ?? []).map((row) => [row.itemId, row])
  );

  const outcomes: OpenOrderApplyOutcome[] = [];

  for (const order of orders) {
    const outcome: OpenOrderApplyOutcome = {
      reference: order.reference,
      partyName: order.partyName,
      orderId: null,
      readableId: null,
      linesCreated: 0,
      commentLines: 0,
      linesSkipped: 0,
      linesFailed: 0,
      error: null
    };
    outcomes.push(outcome);

    const party = partyById.get(order.partyId);
    if (!party) {
      outcome.error = "partyNotFound";
      continue;
    }

    try {
      if (kind === "po") {
        const created = await insertPurchaseOrder(client, {
          supplierId: party.id,
          companyId,
          companyGroupId,
          createdBy: userId,
          supplierReference: order.reference ?? undefined,
          orderDate: isoDate(order.orderDate) ?? undefined,
          receiptRequestedDate: isoDate(order.neededBy) ?? undefined
        });
        if (created.error || !created.data) {
          logger.error("Failed to create draft purchase order", {
            error: created.error
          });
          outcome.error = "createFailed";
          continue;
        }
        outcome.orderId = created.data.id;
        outcome.readableId = created.data.purchaseOrderId;

        for (const line of order.lines) {
          const item = line.itemId ? itemById.get(line.itemId) : undefined;
          if (!item) {
            // No comment line type on purchase orders in the app — the line
            // is left off the draft and reported, never guessed.
            outcome.linesSkipped += 1;
            continue;
          }
          const replenishment = replenishmentByItemId.get(item.id);
          const createdLine = await upsertPurchaseOrderLine(client, {
            purchaseOrderId: created.data.id,
            purchaseOrderLineType: item.type,
            itemId: item.id,
            description: line.description ?? item.name ?? undefined,
            purchaseQuantity: line.quantity,
            supplierUnitPrice: line.unitPrice ?? 0,
            supplierShippingCost: 0,
            supplierTaxAmount: 0,
            exchangeRate: 1,
            purchaseUnitOfMeasureCode:
              replenishment?.purchasingUnitOfMeasureCode ??
              item.unitOfMeasureCode ??
              "EA",
            inventoryUnitOfMeasureCode: item.unitOfMeasureCode ?? "EA",
            conversionFactor: replenishment?.conversionFactor ?? 1,
            requiredDate: isoDate(order.neededBy) ?? undefined,
            companyId,
            createdBy: userId
          });
          if (createdLine.error) {
            logger.error("Failed to create draft purchase order line", {
              error: createdLine.error
            });
            outcome.linesFailed += 1;
          } else {
            outcome.linesCreated += 1;
          }
        }
      } else {
        if (!locationId) {
          outcome.error = "createFailed";
          continue;
        }
        const created = await insertSalesOrder(client, {
          customerId: party.id,
          companyId,
          companyGroupId,
          createdBy: userId,
          customerReference: order.reference ?? undefined,
          orderDate: isoDate(order.orderDate) ?? undefined,
          requestedDate: isoDate(order.neededBy) ?? undefined,
          locationId
        });
        if (created.error || !created.data) {
          logger.error("Failed to create draft sales order", {
            error: created.error
          });
          outcome.error = "createFailed";
          continue;
        }
        outcome.orderId = created.data.id;
        outcome.readableId = created.data.salesOrderId;

        for (const line of order.lines) {
          const item = line.itemId ? itemById.get(line.itemId) : undefined;

          if (!item || item.type === "Fixture") {
            // Description-only comment line — the sales order line service
            // supports these, so the customer keeps the information without
            // us inventing an item.
            const commentText = [
              line.partNumber,
              line.description,
              `× ${line.quantity}`
            ]
              .filter(Boolean)
              .join(" — ");
            const createdComment = await upsertSalesOrderLine(client, {
              salesOrderId: created.data.id,
              salesOrderLineType: "Comment",
              description: commentText,
              locationId,
              taxPercent: 0,
              companyId,
              createdBy: userId
            });
            if (createdComment.error) {
              logger.error("Failed to create sales order comment line", {
                error: createdComment.error
              });
              outcome.linesFailed += 1;
            } else {
              outcome.commentLines += 1;
            }
            continue;
          }

          const createdLine = await upsertSalesOrderLine(client, {
            salesOrderId: created.data.id,
            salesOrderLineType: item.type,
            itemId: item.id,
            description: line.description ?? item.name ?? undefined,
            methodType: item.defaultMethodType ?? "Pull from Inventory",
            saleQuantity: line.quantity,
            unitPrice: line.unitPrice ?? 0,
            setupPrice: 0,
            shippingCost: 0,
            addOnCost: 0,
            nonTaxableAddOnCost: 0,
            taxPercent: party.taxPercent ?? 0,
            unitOfMeasureCode: item.unitOfMeasureCode ?? "EA",
            promisedDate: isoDate(order.neededBy) ?? undefined,
            locationId,
            companyId,
            createdBy: userId
          });
          if (createdLine.error) {
            logger.error("Failed to create draft sales order line", {
              error: createdLine.error
            });
            outcome.linesFailed += 1;
          } else {
            outcome.linesCreated += 1;
          }
        }
      }
    } catch (err) {
      // One bad order never kills the batch.
      logger.error("Failed to apply open order", { error: err });
      if (!outcome.orderId) {
        outcome.error = "createFailed";
      }
    }
  }

  return outcomes;
}
