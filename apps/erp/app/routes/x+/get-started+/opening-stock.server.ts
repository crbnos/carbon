import { openai } from "@ai-sdk/openai";
import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { z } from "zod";

// Opening stock — server pipeline for the cutover count. The customer counts
// the factory on paper (count sheets print from the existing inventory count
// screen), then uploads the filled sheet (CSV/XLSX/TXT or a photo). The AI does
// the typing: it extracts rows, we match them against the count's own lines by
// part number, and the customer reviews before anything is written. Nothing
// posts from here — posting stays on the existing inventory count screen.

const logger = getLogger("erp", "opening-stock");

/** Decoded image size limit for vision extraction (bytes) — mirrors the
 * inspection balloon analyzer's cap. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

// Bounded extraction: enough for a weekend cutover count sheet without blowing
// the model's output budget. Larger factories upload in batches.
const MAX_ROWS = 300;

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const extractedCountRowSchema = z.object({
  partNumber: z.string().min(1).max(120),
  description: z.string().max(200).optional(),
  quantity: z.number().min(0),
  lot: z.string().max(120).optional(),
  serial: z.string().max(120).optional()
});

const countExtractionSchema = z.object({
  rows: z.array(extractedCountRowSchema).max(MAX_ROWS)
});

export type ExtractedCountRow = z.infer<typeof extractedCountRowSchema>;

const EXTRACTION_RULES = `
Rules:
- One output row per counted line: the part number exactly as written, and the counted quantity.
- partNumber is the item / part / material number column (often "Part Number", "Item", "Part ID", or similar) — NOT the row number and NOT the bin.
- quantity is the COUNTED quantity (a handwritten or filled-in number). Columns like "System Qty" or "Expected" are not the count — prefer a column named "Counted", "Count", "Qty Counted", "Actual", or the handwritten value.
- Include lot (batch/lot number) or serial (serial number) only when the row clearly shows one.
- Do NOT guess. Skip any row whose part number or counted quantity is missing or illegible — it is better to omit a row than to invent one.
- Quantities are non-negative numbers. Never invent decimals that are not written.
`;

const IMAGE_SYSTEM = `You transcribe filled physical inventory count sheets from factories.
You receive one photo or scan of a count sheet (possibly handwritten).
Return ONLY the JSON object matching the schema.
${EXTRACTION_RULES}`;

const mediaTypeByExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png"
};

type UploadSource =
  | { kind: "table"; csv: string }
  | { kind: "image"; bytes: Uint8Array; mediaType: string };

async function readUpload(
  client: SupabaseClient<Database>,
  uploadPath: string,
  uploadName: string
): Promise<UploadSource | null> {
  try {
    const download = await client.storage.from("private").download(uploadPath);
    if (download.error || !download.data) {
      if (download.error) {
        logger.error("Failed to download opening stock upload", {
          error: download.error
        });
      }
      return null;
    }

    const extension =
      (uploadName || uploadPath).split(".").pop()?.toLowerCase() ?? "";

    const imageMediaType = mediaTypeByExtension[extension];
    if (imageMediaType) {
      const buffer = await download.data.arrayBuffer();
      if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
      return {
        kind: "image",
        bytes: new Uint8Array(buffer),
        mediaType: imageMediaType
      };
    }

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

    // Bounded sample: header + up to MAX_ROWS data rows, bounded cells/total.
    const sample = rows
      .slice(0, MAX_ROWS + 1)
      .map((row) =>
        row.slice(0, 24).map((cell) => String(cell ?? "").slice(0, 120))
      );
    const csv = Papa.unparse(sample);
    return {
      kind: "table",
      csv: csv.length > 48000 ? csv.slice(0, 48000) : csv
    };
  } catch (err) {
    logger.error("Failed to read opening stock upload", { error: err });
    return null;
  }
}

/** Extract counted rows from the uploaded file. Returns null when the file is
 * unreadable or the AI fails — the caller reports it plainly, never guesses. */
export async function extractOpeningStockRows(
  client: SupabaseClient<Database>,
  args: { uploadPath: string; uploadName: string }
): Promise<ExtractedCountRow[] | null> {
  const source = await readUpload(client, args.uploadPath, args.uploadName);
  if (!source) return null;

  try {
    if (source.kind === "image") {
      const { object } = await generateObject({
        model: openai("gpt-4o"),
        schema: countExtractionSchema,
        system: IMAGE_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe every counted line on this count sheet per the system rules."
              },
              {
                type: "image",
                image: source.bytes,
                mediaType: source.mediaType
              }
            ]
          }
        ],
        temperature: 0
      });
      return object.rows;
    }

    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: countExtractionSchema,
      prompt: `
      A factory switching to a new system counted its stock and filled in a count sheet.
      Below is that sheet as CSV. Extract the counted rows.
      ${EXTRACTION_RULES}
      Sheet:

      ${source.csv}
      `,
      temperature: 0
    });
    return object.rows;
  } catch (err) {
    logger.error("Opening stock AI extraction failed", { error: err });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Matching — deterministic, by item readableId (case-insensitive trim).
// Unmatched rows are reported back with a reason code, never guessed.
// ---------------------------------------------------------------------------

export type OpeningStockMatch = {
  lineId: string;
  partNumber: string;
  itemName: string | null;
  quantity: number;
};

export type OpeningStockUnmatched = {
  partNumber: string;
  description: string | null;
  quantity: number;
  reason: "notOnCount" | "multipleBins";
};

export type OpeningStockTracked = {
  partNumber: string;
  itemName: string | null;
  quantity: number;
  lot: string | null;
};

export type OpeningStockProposal = {
  matched: OpeningStockMatch[];
  unmatched: OpeningStockUnmatched[];
  tracked: OpeningStockTracked[];
};

type CountLineForMatch = {
  id: string;
  itemName: string | null;
  itemReadableIdWithRevision: string | null;
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"] | null;
};

const normalize = (value: string) => value.trim().toLowerCase();

/** Match extracted rows against the count's lines. Duplicate rows for the same
 * line are summed (the same part counted in several places on the sheet).
 * Lot/serial tracked items are never written from here — entering tracked
 * quantities is specialized and belongs on the count screen. */
export async function matchOpeningStockRows(
  client: SupabaseClient<Database>,
  args: {
    inventoryCountId: string;
    companyId: string;
    rows: ExtractedCountRow[];
  }
): Promise<OpeningStockProposal | null> {
  const { inventoryCountId, companyId, rows } = args;

  const lines = await fetchAllFromTable<CountLineForMatch>(
    client,
    "inventoryCountLines",
    "id, itemName, itemReadableIdWithRevision, itemTrackingType",
    (query) =>
      query.eq("inventoryCountId", inventoryCountId).eq("companyId", companyId)
  );
  if (lines.error || !lines.data) {
    logger.error("Failed to load count lines for matching", {
      error: lines.error
    });
    return null;
  }

  const linesByKey = new Map<string, CountLineForMatch[]>();
  for (const line of lines.data) {
    if (!line.id) continue;
    const key = normalize(line.itemReadableIdWithRevision ?? "");
    if (!key) continue;
    const bucket = linesByKey.get(key);
    if (bucket) {
      bucket.push(line);
    } else {
      linesByKey.set(key, [line]);
    }
  }

  const matchedByLine = new Map<string, OpeningStockMatch>();
  const unmatched: OpeningStockUnmatched[] = [];
  const tracked: OpeningStockTracked[] = [];

  for (const row of rows) {
    const key = normalize(row.partNumber);
    const bucket = key ? linesByKey.get(key) : undefined;

    if (!bucket || bucket.length === 0) {
      unmatched.push({
        partNumber: row.partNumber,
        description: row.description ?? null,
        quantity: row.quantity,
        reason: "notOnCount"
      });
      continue;
    }

    // Tracking type is per item, so it is uniform across the bucket.
    const isTracked = bucket.some(
      (line) =>
        line.itemTrackingType === "Serial" || line.itemTrackingType === "Batch"
    );
    if (isTracked) {
      tracked.push({
        partNumber: row.partNumber,
        itemName: bucket[0]?.itemName ?? null,
        quantity: row.quantity,
        lot: row.lot ?? row.serial ?? null
      });
      continue;
    }

    if (bucket.length > 1) {
      // The item is on the count in more than one bin — applying one number
      // would be a guess about which bin it belongs to.
      unmatched.push({
        partNumber: row.partNumber,
        description: row.description ?? null,
        quantity: row.quantity,
        reason: "multipleBins"
      });
      continue;
    }

    const line = bucket[0]!;
    const existing = matchedByLine.get(line.id);
    if (existing) {
      existing.quantity += row.quantity;
    } else {
      matchedByLine.set(line.id, {
        lineId: line.id,
        partNumber: line.itemReadableIdWithRevision ?? row.partNumber,
        itemName: line.itemName,
        quantity: row.quantity
      });
    }
  }

  return {
    matched: Array.from(matchedByLine.values()),
    unmatched,
    tracked
  };
}

// ---------------------------------------------------------------------------
// Greenfield top-up. At a true cutover nothing has itemLedger history yet, so
// the snapshot generator produces no lines for exactly the items the factory
// is about to count. Add zero-baseline lines for every active,
// quantity-tracked, non-lot/serial item the snapshot skipped — posting then
// books delta = counted − 0 as the opening adjustment, which is the point.
// Lot/serial items stay off the sheet on purpose (tracked-entity entry lives
// on the count screen).
// ---------------------------------------------------------------------------

import type { Kysely, KyselyDatabase } from "@carbon/database/client";

export async function topUpOpeningStockLines(
  db: Kysely<KyselyDatabase>,
  args: {
    inventoryCountId: string;
    companyId: string;
    locationId: string;
    createdBy: string;
  }
): Promise<number> {
  const existing = await db
    .selectFrom("inventoryCountLine")
    .select("itemId")
    .where("inventoryCountId", "=", args.inventoryCountId)
    .where("companyId", "=", args.companyId)
    .execute();
  const covered = new Set(existing.map((line) => line.itemId));

  const items = await db
    .selectFrom("item")
    .select(["id", "readableIdWithRevision"])
    .where("companyId", "=", args.companyId)
    .where("itemTrackingType", "=", "Inventory")
    .where("active", "=", true)
    .execute();

  const missing = items.filter((item) => !covered.has(item.id));
  if (missing.length === 0) return 0;

  await db
    .insertInto("inventoryCountLine")
    .values(
      missing.map((item) => ({
        companyId: args.companyId,
        inventoryCountId: args.inventoryCountId,
        itemId: item.id,
        locationId: args.locationId,
        readableId: item.readableIdWithRevision,
        systemQuantity: 0,
        createdBy: args.createdBy
      }))
    )
    .execute();

  return missing.length;
}
