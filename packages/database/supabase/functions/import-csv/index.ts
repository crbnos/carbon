import { parse } from "https://deno.land/std@0.175.0/encoding/csv.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { sql } from "npm:kysely@0.27.6";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { getReadableIdWithRevision } from "../lib/utils.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const importCsvValidator = z.object({
  table: z.enum([
    "consumable",
    "customer",
    "customerContact",
    "fixture",
    "material",
    "methodMaterial",
    "part",
    "supplier",
    "supplierContact",
    "tool",
    "workCenter",
    "process",
  ]),
  filePath: z.string(),
  columnMappings: z.record(z.string()),
  enumMappings: z.record(z.record(z.string())).optional(),
  companyId: z.string(),
  userId: z.string(),
});

const EXTERNAL_ID_KEY = "csv";

/**
 * Fallback CSV parser used when std/csv rejects a row-length mismatch.
 * Handles RFC-4180 quoting but tolerates uneven row widths (extra cells
 * dropped, missing cells become "").
 */
function parsePermissiveCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // \r\n: consume the \n that follows
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Skip blank rows that arise from trailing newlines
      if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
        rows.push(row);
      }
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = r[i] ?? "";
    }
    return obj;
  });
}

type CsvEntityType =
  | "customer"
  | "supplier"
  | "item"
  | "contact"
  | "workCenter"
  | "process";

/**
 * Look up the ids that still exist in the entity table. Done as a typed
 * switch so each Kysely query is fully type-checked — avoids `as any` casts
 * that bypass the generated DB types.
 */
async function fetchLiveEntityIds(
  entityType: CsvEntityType,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  let rows: { id: string }[];
  switch (entityType) {
    case "customer":
      rows = await db
        .selectFrom("customer")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "supplier":
      rows = await db
        .selectFrom("supplier")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "item":
      rows = await db
        .selectFrom("item")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "contact":
      rows = await db
        .selectFrom("contact")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "workCenter":
      rows = await db
        .selectFrom("workCenter")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "process":
      rows = await db
        .selectFrom("process")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
  }
  return new Set(rows.map((r) => r.id));
}

/**
 * Build a name → id map for an entity table, scoped to a company and to the
 * specific names the caller cares about. Used as a fallback dedup key when
 * the CSV's Unique ID has no externalIntegrationMapping row yet (e.g., the
 * entity was created in-app, then a CSV with the same name is imported).
 * Scoping the query to `namesToCheck` avoids a full-table scan on
 * supplier/customer for companies with large rosters.
 */
async function getNameMap(
  entityType: "supplier" | "customer",
  cId: string,
  namesToCheck: string[]
): Promise<Map<string, string>> {
  if (namesToCheck.length === 0) return new Map();
  const rows =
    entityType === "supplier"
      ? await db
          .selectFrom("supplier")
          .select(["id", "name"])
          .where("companyId", "=", cId)
          .where("name", "in", namesToCheck)
          .execute()
      : await db
          .selectFrom("customer")
          .select(["id", "name"])
          .where("companyId", "=", cId)
          .where("name", "in", namesToCheck)
          .execute();
  return new Map(rows.map((r) => [r.name, r.id]));
}

/**
 * Build a map of CSV external IDs → entity IDs from externalIntegrationMapping.
 * Filters orphan mappings (rows whose entityId points at a deleted entity)
 * so re-imports cleanly take the INSERT path instead of failing the
 * subsequent supplierTax/customerTax upsert with a 23503 FK error.
 */
async function getCsvExternalIdMap(
  entityType: CsvEntityType,
  cId: string
): Promise<Map<string, string>> {
  const result = await db
    .selectFrom("externalIntegrationMapping")
    .select(["externalId", "entityId"])
    .where("entityType", "=", entityType)
    .where("integration", "=", EXTERNAL_ID_KEY)
    .where("companyId", "=", cId)
    .execute();

  const candidates = result.filter(
    (r): r is typeof r & { externalId: string; entityId: string } =>
      r.externalId !== null && r.entityId !== null
  );

  if (candidates.length === 0) return new Map();

  const liveIds = await fetchLiveEntityIds(
    entityType,
    candidates.map((r) => r.entityId)
  );

  return new Map(
    candidates
      .filter((r) => liveIds.has(r.entityId))
      .map((r) => [r.externalId, r.entityId])
  );
}

/**
 * Convert empty-string values to undefined. Kysely drops undefined keys from
 * the INSERT, so the column gets its DB default (NULL). Empty CSV cells would
 * otherwise become literal "" and fail FK or enum constraints.
 */
function nullifyEmptyStrings<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === "" ? undefined : v;
  }
  return out as Partial<T>;
}

/**
 * Upsert CSV external ID mappings into the externalIntegrationMapping table.
 * Uses ON CONFLICT to handle re-imports idempotently.
 */
async function upsertCsvMappings(
  trx: typeof db,
  entityType: CsvEntityType,
  mappings: Array<{ entityId: string; externalId: string }>,
  cId: string,
  userId: string
): Promise<void> {
  if (mappings.length === 0) return;

  const now = new Date().toISOString();

  await trx
    .insertInto("externalIntegrationMapping")
    .values(
      mappings.map((m) => ({
        entityType,
        entityId: m.entityId,
        integration: EXTERNAL_ID_KEY,
        externalId: m.externalId,
        companyId: cId,
        allowDuplicateExternalId: false,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }))
    )
    // On conflict (orphan mapping with same csv id but stale entityId),
    // repoint entityId to the freshly-inserted entity. The .where() matches
    // the partial unique index's predicate, required by Postgres for
    // arbitration on partial indexes (42P10 otherwise).
    .onConflict((oc) =>
      oc
        .columns(["integration", "externalId", "entityType", "companyId"])
        .where("allowDuplicateExternalId", "=", false)
        .doUpdateSet((eb) => ({
          entityId: eb.ref("excluded.entityId"),
          updatedAt: eb.ref("excluded.updatedAt"),
        }))
    )
    .execute();
}

/**
 * Address/payment/shipping fields that can ride along on a supplier or
 * customer CSV row. Written to side-tables (address + supplierLocation /
 * supplierPayment / supplierShipping, mirror for customer) after the parent
 * upsert lands.
 */
type PartnerExtensionData = {
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
  paymentTermId?: string;
  shippingMethodId?: string;
  incoterm?: string;
  incotermLocation?: string;
};

function extractPartnerExtensions(
  record: Record<string, string>
): PartnerExtensionData {
  return {
    locationName: record.locationName,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    state: record.state,
    postalCode: record.postalCode,
    countryCode: record.countryCode,
    paymentTermId: record.paymentTermId,
    shippingMethodId: record.shippingMethodId,
    incoterm: record.incoterm,
    incotermLocation: record.incotermLocation,
  };
}

function hasAnyAddressField(ext: PartnerExtensionData): boolean {
  // Require addressLine1 to recognize a row as having an address. It's the
  // most distinguishing line of a postal address and also doubles as the
  // location-name fallback when `Location Name` is blank — without it,
  // creating a supplierLocation/customerLocation would have no usable label.
  return !!ext.addressLine1;
}

function buildAddressFields(
  ext: PartnerExtensionData
): {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  countryCode: string | null;
} {
  return {
    addressLine1: ext.addressLine1 || null,
    addressLine2: ext.addressLine2 || null,
    city: ext.city || null,
    // The CSV field is `state` (user-facing label "State / Region"); the
    // column was renamed to stateProvince in migration 20240928155702.
    stateProvince: ext.state || null,
    postalCode: ext.postalCode || null,
    // address.countryCode is TEXT storing ISO 3166-1 alpha-2 (e.g., "US"),
    // post-20240928155702_country-codes.
    countryCode: ext.countryCode || null,
  };
}

/**
 * Bulk-load the addressId of each entity's primary (lowest-id) location.
 * Used by the supplier/customer extension UPDATE paths to avoid an N+1
 * SELECT per entity inside the per-row loop. New inserts pass undefined
 * since by construction they have no location yet.
 */
async function preloadPrimaryLocationAddressIds(
  trx: typeof db,
  entityType: "supplier" | "customer",
  entityIds: string[]
): Promise<Map<string, string>> {
  if (entityIds.length === 0) return new Map();
  const rows =
    entityType === "supplier"
      ? await trx
          .selectFrom("supplierLocation")
          .select(["supplierId", "id", "addressId"])
          .where("supplierId", "in", entityIds)
          .orderBy("id")
          .execute()
      : await trx
          .selectFrom("customerLocation")
          .select(["customerId", "id", "addressId"])
          .where("customerId", "in", entityIds)
          .orderBy("id")
          .execute();
  const map = new Map<string, string>();
  for (const row of rows) {
    const key =
      entityType === "supplier"
        ? (row as { supplierId: string }).supplierId
        : (row as { customerId: string }).customerId;
    if (!map.has(key)) map.set(key, row.addressId);
  }
  return map;
}

async function writeSupplierExtensions(
  trx: typeof db,
  supplierId: string,
  ext: PartnerExtensionData,
  companyId: string,
  userId: string,
  // Pre-fetched addressId of the supplier's existing primary location, if
  // any. Caller bulk-loads these for the whole batch to avoid an N+1
  // SELECT per supplier. undefined means "no existing location → insert".
  existingAddressId: string | undefined
): Promise<void> {
  const now = new Date().toISOString();

  if (hasAnyAddressField(ext)) {
    const addressFields = buildAddressFields(ext);

    if (existingAddressId) {
      await trx
        .updateTable("address")
        .set(addressFields)
        .where("id", "=", existingAddressId)
        .execute();
    } else {
      const inserted = await trx
        .insertInto("address")
        .values({ ...addressFields, companyId })
        .returning(["id"])
        .executeTakeFirst();
      if (inserted?.id) {
        await trx
          .insertInto("supplierLocation")
          .values({
            supplierId,
            addressId: inserted.id,
            // supplierLocation.name is NOT NULL. Prefer the user's
            // Location Name column; fall back to Address Line 1 so the row
            // always has a recognizable label.
            name: ext.locationName || ext.addressLine1,
          })
          .execute();
      }
    }
  }

  if (ext.paymentTermId) {
    // The sync_create_supplier_entries interceptor creates the supplierPayment
    // row on supplier INSERT; UPSERT here makes us resilient to edge cases
    // where that row is somehow missing.
    await trx
      .insertInto("supplierPayment")
      .values({
        supplierId,
        paymentTermId: ext.paymentTermId,
        companyId,
        updatedAt: now,
        updatedBy: userId,
      })
      .onConflict((oc) =>
        oc.column("supplierId").doUpdateSet({
          paymentTermId: ext.paymentTermId,
          updatedAt: now,
          updatedBy: userId,
        })
      )
      .execute();
  }

  if (ext.shippingMethodId || ext.incoterm || ext.incotermLocation) {
    // Build the conditional update separately from the always-set fields so
    // ON CONFLICT only touches columns the user provided in the CSV — blank
    // cells don't overwrite existing values on re-import. The incoterm cast
    // narrows `string` to the Postgres enum union; Postgres rejects invalid
    // values at insert time as a safety net.
    const partialUpdate = {
      ...(ext.shippingMethodId
        ? { shippingMethodId: ext.shippingMethodId }
        : {}),
      ...(ext.incoterm
        ? {
            incoterm: ext.incoterm as Database["public"]["Enums"]["incoterm"],
          }
        : {}),
      ...(ext.incotermLocation
        ? { incotermLocation: ext.incotermLocation }
        : {}),
    };
    await trx
      .insertInto("supplierShipping")
      .values({
        supplierId,
        companyId,
        updatedAt: now,
        updatedBy: userId,
        ...partialUpdate,
      })
      .onConflict((oc) =>
        oc.column("supplierId").doUpdateSet({
          updatedAt: now,
          updatedBy: userId,
          ...partialUpdate,
        })
      )
      .execute();
  }
}

async function writeCustomerExtensions(
  trx: typeof db,
  customerId: string,
  ext: PartnerExtensionData,
  companyId: string,
  userId: string,
  existingAddressId: string | undefined
): Promise<void> {
  const now = new Date().toISOString();

  if (hasAnyAddressField(ext)) {
    const addressFields = buildAddressFields(ext);

    if (existingAddressId) {
      await trx
        .updateTable("address")
        .set(addressFields)
        .where("id", "=", existingAddressId)
        .execute();
    } else {
      const inserted = await trx
        .insertInto("address")
        .values({ ...addressFields, companyId })
        .returning(["id"])
        .executeTakeFirst();
      if (inserted?.id) {
        await trx
          .insertInto("customerLocation")
          .values({
            customerId,
            addressId: inserted.id,
            // customerLocation.name is NOT NULL. Prefer the user's
            // Location Name column; fall back to Address Line 1.
            name: ext.locationName || ext.addressLine1,
          })
          .execute();
      }
    }
  }

  if (ext.paymentTermId) {
    await trx
      .insertInto("customerPayment")
      .values({
        customerId,
        paymentTermId: ext.paymentTermId,
        companyId,
        updatedAt: now,
        updatedBy: userId,
      })
      .onConflict((oc) =>
        oc.column("customerId").doUpdateSet({
          paymentTermId: ext.paymentTermId,
          updatedAt: now,
          updatedBy: userId,
        })
      )
      .execute();
  }

}

/**
 * Idempotent supplierPart writes for the part/material/tool/fixture/consumable
 * import flow. One CSV row optionally creates one supplierPart link; re-imports
 * UPDATE the existing row (matched by (itemId, supplierId) per company).
 */
type SupplierPartImportLink = {
  itemId: string;
  supplierId: string;
  supplierPartId?: string;
  supplierUnitOfMeasureCode?: string;
  minimumOrderQuantity?: string;
  orderMultiple?: string;
  conversionFactor?: string;
  unitPrice?: string;
};

type ItemPurchasingLeadTime = {
  itemId: string;
  leadTime: string;
};

type ItemPlanningOrderMultiple = {
  itemId: string;
  orderMultiple: string;
};

async function writeSupplierPartLinks(
  trx: typeof db,
  links: SupplierPartImportLink[],
  companyId: string,
  userId: string
): Promise<void> {
  if (links.length === 0) return;
  const itemIds = [...new Set(links.map((l) => l.itemId))];
  const supplierIds = [...new Set(links.map((l) => l.supplierId))];
  const existing = await trx
    .selectFrom("supplierPart")
    .select(["id", "itemId", "supplierId"])
    .where("itemId", "in", itemIds)
    .where("supplierId", "in", supplierIds)
    .where("companyId", "=", companyId)
    .execute();
  const existingByPair = new Map(
    existing.map((e) => [`${e.itemId}:${e.supplierId}`, e.id])
  );

  const now = new Date().toISOString();
  for (const link of links) {
    const key = `${link.itemId}:${link.supplierId}`;
    const existingId = existingByPair.get(key);
    const numericMOQ = link.minimumOrderQuantity
      ? Number.parseInt(link.minimumOrderQuantity, 10)
      : null;
    const numericOrderMultiple = link.orderMultiple
      ? Number.parseInt(link.orderMultiple, 10)
      : null;
    const numericConversion = link.conversionFactor
      ? Number.parseFloat(link.conversionFactor)
      : 1;
    const numericPrice = link.unitPrice
      ? Number.parseFloat(link.unitPrice)
      : null;

    if (existingId) {
      await trx
        .updateTable("supplierPart")
        .set({
          supplierPartId: link.supplierPartId || null,
          supplierUnitOfMeasureCode: link.supplierUnitOfMeasureCode || null,
          minimumOrderQuantity: numericMOQ,
          orderMultiple: numericOrderMultiple,
          conversionFactor: numericConversion,
          unitPrice: numericPrice,
          updatedAt: now,
          updatedBy: userId,
        })
        .where("id", "=", existingId)
        .execute();
    } else {
      await trx
        .insertInto("supplierPart")
        .values({
          itemId: link.itemId,
          supplierId: link.supplierId,
          supplierPartId: link.supplierPartId || null,
          supplierUnitOfMeasureCode: link.supplierUnitOfMeasureCode || null,
          minimumOrderQuantity: numericMOQ,
          orderMultiple: numericOrderMultiple,
          conversionFactor: numericConversion,
          unitPrice: numericPrice,
          companyId,
          createdBy: userId,
        })
        .execute();
    }
  }
}

// Set the item-level purchasing lead time (the "Purchasing" tab field).
// The itemReplenishment row is created by the create_item_related_records
// AFTER INSERT trigger on item (default leadTime 7, per migration
// 20250610000433_demand-planning.sql which renamed purchasingLeadTime →
// leadTime), so within this transaction the row already exists for every
// item we just upserted — we only need to UPDATE it.
async function writeItemPurchasingLeadTimes(
  trx: typeof db,
  entries: ItemPurchasingLeadTime[],
  companyId: string,
  userId: string
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  for (const entry of entries) {
    const numericLeadTime = Number.parseInt(entry.leadTime, 10);
    if (Number.isNaN(numericLeadTime)) continue;
    await trx
      .updateTable("itemReplenishment")
      .set({
        leadTime: numericLeadTime,
        updatedAt: now,
        updatedBy: userId,
      })
      .where("itemId", "=", entry.itemId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

// Set the item-level planning order multiple. itemPlanning has one row per
// (item, location) pair, all created by create_item_related_records at item
// insert time (SELECT FROM location WHERE companyId = ...). A single UPDATE
// scoped by itemId + companyId therefore covers every location row for that
// item — matching the "order multiple is unique across every location"
// expectation. Mirrors the same CSV value already written to
// supplierPart.orderMultiple in writeSupplierPartLinks; both are intentionally
// kept in sync at import time even though they're structurally distinct
// fields (supplier case-pack vs MRP preferred multiple).
async function writeItemPlanningOrderMultiples(
  trx: typeof db,
  entries: ItemPlanningOrderMultiple[],
  companyId: string,
  userId: string
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  for (const entry of entries) {
    const numericOrderMultiple = Number.parseInt(entry.orderMultiple, 10);
    if (Number.isNaN(numericOrderMultiple) || numericOrderMultiple < 1) continue;
    await trx
      .updateTable("itemPlanning")
      .set({
        orderMultiple: numericOrderMultiple,
        updatedAt: now,
        updatedBy: userId,
      })
      .where("itemId", "=", entry.itemId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

async function upsertTaxIdentifiers(
  trx: typeof db,
  table: "customerTax" | "supplierTax",
  records: Array<{ entityId: string; taxId: string | null | undefined }>,
  cId: string,
  userId: string
): Promise<void> {
  if (records.length === 0) return;

  const now = new Date().toISOString();
  if (table === "customerTax") {
    await trx
      .insertInto("customerTax")
      .values(
        records.map((r) => ({
          customerId: r.entityId,
          taxId: r.taxId ?? null,
          companyId: cId,
          updatedAt: now,
          updatedBy: userId,
        }))
      )
      .onConflict((oc) =>
        oc.column("customerId").doUpdateSet({
          taxId: sql`excluded."taxId"`,
          updatedAt: now,
          updatedBy: userId,
        })
      )
      .execute();
    return;
  }
  await trx
    .insertInto("supplierTax")
    .values(
      records.map((r) => ({
        supplierId: r.entityId,
        taxId: r.taxId ?? null,
        companyId: cId,
        updatedAt: now,
        updatedBy: userId,
      }))
    )
    .onConflict((oc) =>
      oc.column("supplierId").doUpdateSet({
        taxId: sql`excluded."taxId"`,
        updatedAt: now,
        updatedBy: userId,
      })
    )
    .execute();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const {
      table,
      filePath,
      columnMappings,
      enumMappings = {},
      companyId,
      userId,
    } = importCsvValidator.parse(payload);

    console.log({
      function: "import-csv",
      table,
      filePath,
      columnMappings,
      enumMappings,
      companyId,
      userId,
    });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const csvFile = await client.storage.from("private").download(filePath);
    if (!csvFile.data) {
      throw new Error("Failed to download file");
    }
    const csvText = new TextDecoder().decode(
      new Uint8Array(await csvFile.data.arrayBuffer())
    );
    // std/csv is strict on row-length mismatches; fall back to the
    // permissive parser for real-world CSVs with quoting/comma issues.
    let parsedCsv: Record<string, string>[];
    try {
      parsedCsv = parse(csvText, {
        skipFirstRow: true,
        lazyQuotes: true,
      }) as Record<string, string>[];
    } catch (_strictErr) {
      parsedCsv = parsePermissiveCsv(csvText);
    }

    let mappedRecords = parsedCsv.map((row) => {
      const record: Record<string, string> = {};
      for (const [key, value] of Object.entries(columnMappings)) {
        if (key in enumMappings) {
          const enumMapping = enumMappings[key];
          const csvValue = row[value];
          if (csvValue in enumMapping) {
            record[key] = enumMapping[csvValue];
          } else {
            record[key] = enumMapping["Default"];
          }
        } else if (value && value !== "N/A") {
          record[key] = row[value] || "";
        }
      }
      return record;
    });

    const missingEnumKeys = Object.keys(enumMappings).filter(
      (key) => !(key in mappedRecords[0])
    );

    if (missingEnumKeys.length > 0) {
      mappedRecords = mappedRecords.map((record) => {
        const processedRecord = { ...record };

        missingEnumKeys.forEach((key) => {
          processedRecord[key] = enumMappings[key]["Default"];
        });

        return processedRecord;
      });
    }

    switch (table) {
      case "customer": {
        const externalIdMap = await getCsvExternalIdMap("customer", companyId);
        const csvNames = Array.from(
          new Set(
            mappedRecords
              .map((r) => r.name)
              .filter((n): n is string => typeof n === "string" && n !== "")
          )
        );
        const nameMap = await getNameMap("customer", companyId, csvNames);
        const customerIds = new Set();
        // Tracks names queued for INSERT in this batch so a second CSV row
        // with the same name doesn't trip the (name, companyId) unique
        // constraint at flush time. The customer table enforces one record
        // per name per company, so duplicates within the CSV collapse.
        const namesQueuedForInsert = new Set<string>();

        await db.transaction().execute(async (trx) => {
          const customerInserts: Database["public"]["Tables"]["customer"]["Insert"][] =
            [];
          const customerTaxForInserts: Array<{
            taxId: string | null | undefined;
          }> = [];
          const csvIdsForInserts: string[] = [];
          const customerUpdates: {
            id: string;
            data: Database["public"]["Tables"]["customer"]["Update"];
          }[] = [];
          const customerTaxUpdates: Array<{
            entityId: string;
            taxId: string | null | undefined;
          }> = [];
          // Updates matched by name (no pre-existing csv mapping). After the
          // updates run, we add csv mappings for these so the next import takes
          // the externalIdMap path directly.
          const csvIdsForNameMatchedUpdates: Array<{
            entityId: string;
            externalId: string;
          }> = [];
          const extForInserts: PartnerExtensionData[] = [];
          const extForUpdates: Array<{
            entityId: string;
            ext: PartnerExtensionData;
          }> = [];

          const isCustomerValid = (
            record: Record<string, string>
          ): record is { name: string } => {
            return typeof record.name === "string" && record.name.trim() !== "";
          };

          for (const record of mappedRecords) {
            const ext = extractPartnerExtensions(record);
            const {
              id,
              taxId,
              locationName: _ln,
              addressLine1: _a1,
              addressLine2: _a2,
              city: _city,
              state: _state,
              postalCode: _pc,
              countryCode: _cc,
              paymentTermId: _pt,
              shippingMethodId: _sm,
              incoterm: _ic,
              incotermLocation: _icl,
              ...rest
            } = record;
            const matchedByCsvId = externalIdMap.get(id);
            const matchedByName =
              matchedByCsvId === undefined && rest.name
                ? nameMap.get(rest.name)
                : undefined;
            const existingEntityId = matchedByCsvId ?? matchedByName;

            if (existingEntityId !== undefined) {
              if (isCustomerValid(rest) && !customerIds.has(id)) {
                customerIds.add(id);
                customerUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...nullifyEmptyStrings(rest),
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                  },
                });
                customerTaxUpdates.push({ entityId: existingEntityId, taxId });
                extForUpdates.push({ entityId: existingEntityId, ext });
                if (matchedByCsvId === undefined) {
                  csvIdsForNameMatchedUpdates.push({
                    entityId: existingEntityId,
                    externalId: id,
                  });
                }
              }
            } else if (isCustomerValid(rest) && !customerIds.has(id)) {
              if (namesQueuedForInsert.has(rest.name)) continue;
              customerIds.add(id);
              namesQueuedForInsert.add(rest.name);
              customerInserts.push({
                ...nullifyEmptyStrings(rest),
                // Use the CSV's Unique ID as the readableId; trigger no-ops
                // when readableId is non-null.
                readableId: id,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
              });
              customerTaxForInserts.push({ taxId });
              csvIdsForInserts.push(id);
              extForInserts.push(ext);
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            customerInserts: customerInserts.length,
            customerUpdates: customerUpdates.length,
          });

          if (customerInserts.length > 0) {
            const inserted = await trx
              .insertInto(table)
              .values(customerInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "customer",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForInserts[i],
              })),
              companyId,
              userId
            );
            await upsertTaxIdentifiers(
              trx,
              "customerTax",
              inserted.map((row, i) => ({
                entityId: row.id!,
                taxId: customerTaxForInserts[i]?.taxId,
              })),
              companyId,
              userId
            );
            for (let i = 0; i < inserted.length; i++) {
              // Newly-inserted customers can't have an existing location yet.
              await writeCustomerExtensions(
                trx,
                inserted[i].id!,
                extForInserts[i] ?? {},
                companyId,
                userId,
                undefined
              );
            }
          }
          if (customerUpdates.length > 0) {
            for (const update of customerUpdates) {
              await trx
                .updateTable(table)
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
            await upsertTaxIdentifiers(
              trx,
              "customerTax",
              customerTaxUpdates,
              companyId,
              userId
            );
            const customerAddressByEntity =
              await preloadPrimaryLocationAddressIds(
                trx,
                "customer",
                extForUpdates.map((u) => u.entityId)
              );
            for (const { entityId, ext } of extForUpdates) {
              await writeCustomerExtensions(
                trx,
                entityId,
                ext,
                companyId,
                userId,
                customerAddressByEntity.get(entityId)
              );
            }
          }
          if (csvIdsForNameMatchedUpdates.length > 0) {
            await upsertCsvMappings(
              trx,
              "customer",
              csvIdsForNameMatchedUpdates,
              companyId,
              userId
            );
          }
        });
        break;
      }
      case "supplier": {
        const externalIdMap = await getCsvExternalIdMap("supplier", companyId);
        const csvNames = Array.from(
          new Set(
            mappedRecords
              .map((r) => r.name)
              .filter((n): n is string => typeof n === "string" && n !== "")
          )
        );
        const nameMap = await getNameMap("supplier", companyId, csvNames);
        const supplierIds = new Set();
        const namesQueuedForInsert = new Set<string>();

        await db.transaction().execute(async (trx) => {
          const supplierInserts: Database["public"]["Tables"]["supplier"]["Insert"][] =
            [];
          const supplierTaxForInserts: Array<{
            taxId: string | null | undefined;
          }> = [];
          const csvIdsForInserts: string[] = [];
          const supplierUpdates: {
            id: string;
            data: Database["public"]["Tables"]["supplier"]["Update"];
          }[] = [];
          const supplierTaxUpdates: Array<{
            entityId: string;
            taxId: string | null | undefined;
          }> = [];
          const csvIdsForNameMatchedUpdates: Array<{
            entityId: string;
            externalId: string;
          }> = [];
          // Parallel to supplierInserts / supplierUpdates — captures the
          // address/payment/incoterm fields so we can write to side-tables
          // after the parent upsert lands.
          const extForInserts: PartnerExtensionData[] = [];
          const extForUpdates: Array<{
            entityId: string;
            ext: PartnerExtensionData;
          }> = [];

          const isSupplierValid = (
            record: Record<string, string>
          ): record is { name: string } => {
            return typeof record.name === "string" && record.name.trim() !== "";
          };

          for (const record of mappedRecords) {
            const ext = extractPartnerExtensions(record);
            const {
              id,
              taxId,
              locationName: _ln,
              addressLine1: _a1,
              addressLine2: _a2,
              city: _city,
              state: _state,
              postalCode: _pc,
              countryCode: _cc,
              paymentTermId: _pt,
              shippingMethodId: _sm,
              incoterm: _ic,
              incotermLocation: _icl,
              ...rest
            } = record;
            const matchedByCsvId = externalIdMap.get(id);
            const matchedByName =
              matchedByCsvId === undefined && rest.name
                ? nameMap.get(rest.name)
                : undefined;
            const existingEntityId = matchedByCsvId ?? matchedByName;

            if (existingEntityId !== undefined && !supplierIds.has(id)) {
              supplierIds.add(id);
              if (isSupplierValid(rest)) {
                supplierUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...nullifyEmptyStrings(rest),
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                  },
                });
                supplierTaxUpdates.push({ entityId: existingEntityId, taxId });
                extForUpdates.push({ entityId: existingEntityId, ext });
                if (matchedByCsvId === undefined) {
                  csvIdsForNameMatchedUpdates.push({
                    entityId: existingEntityId,
                    externalId: id,
                  });
                }
              }
            } else if (isSupplierValid(rest) && !supplierIds.has(id)) {
              if (namesQueuedForInsert.has(rest.name)) continue;
              supplierIds.add(id);
              namesQueuedForInsert.add(rest.name);
              supplierInserts.push({
                ...nullifyEmptyStrings(rest),
                // Use the CSV's Unique ID as the readableId; trigger no-ops
                // when readableId is non-null.
                readableId: id,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
              });
              supplierTaxForInserts.push({ taxId });
              csvIdsForInserts.push(id);
              extForInserts.push(ext);
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            supplierInserts: supplierInserts.length,
            supplierUpdates: supplierUpdates.length,
          });

          if (supplierInserts.length > 0) {
            const inserted = await trx
              .insertInto(table)
              .values(supplierInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "supplier",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForInserts[i],
              })),
              companyId,
              userId
            );
            await upsertTaxIdentifiers(
              trx,
              "supplierTax",
              inserted.map((row, i) => ({
                entityId: row.id!,
                taxId: supplierTaxForInserts[i]?.taxId,
              })),
              companyId,
              userId
            );
            for (let i = 0; i < inserted.length; i++) {
              // Newly-inserted suppliers can't have an existing location yet.
              await writeSupplierExtensions(
                trx,
                inserted[i].id!,
                extForInserts[i] ?? {},
                companyId,
                userId,
                undefined
              );
            }
          }
          if (supplierUpdates.length > 0) {
            for (const update of supplierUpdates) {
              await trx
                .updateTable(table)
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
            await upsertTaxIdentifiers(
              trx,
              "supplierTax",
              supplierTaxUpdates,
              companyId,
              userId
            );
            const supplierAddressByEntity =
              await preloadPrimaryLocationAddressIds(
                trx,
                "supplier",
                extForUpdates.map((u) => u.entityId)
              );
            for (const { entityId, ext } of extForUpdates) {
              await writeSupplierExtensions(
                trx,
                entityId,
                ext,
                companyId,
                userId,
                supplierAddressByEntity.get(entityId)
              );
            }
          }
          if (csvIdsForNameMatchedUpdates.length > 0) {
            await upsertCsvMappings(
              trx,
              "supplier",
              csvIdsForNameMatchedUpdates,
              companyId,
              userId
            );
          }
        });
        break;
      }
      case "material":
      case "consumable":
      case "tool":
      case "fixture":
      case "part": {
        const getExternalId = (id: string) => {
          return `${table}:${id}`;
        };

        const externalIdMap = await getCsvExternalIdMap("item", companyId);
        const readableIds = new Set();

        await db.transaction().execute(async (trx) => {
          const itemInserts: Database["public"]["Tables"]["item"]["Insert"][] =
            [];
          const csvIdsForInserts: string[] = [];
          const itemUpdates: {
            id: string;
            data: Database["public"]["Tables"]["item"]["Update"];
          }[] = [];
          const materialPartialInserts: Record<
            string,
            Database["public"]["Tables"]["material"]["Insert"]
          > = {};

          const materialUpdates: {
            id: string;
            data: Database["public"]["Tables"]["material"]["Update"];
          }[] = [];

          // Optional supplier-part fields ride along on each row. Parallel to
          // itemInserts; supplierPartLinks accumulates the full resolved
          // links (with the item's actual DB id) as the inserts/updates land.
          const supplierPartForInserts: Array<{
            supplierId?: string;
            supplierPartId?: string;
            supplierUnitOfMeasureCode?: string;
            minimumOrderQuantity?: string;
            orderMultiple?: string;
            conversionFactor?: string;
            unitPrice?: string;
          }> = [];
          const supplierPartLinks: SupplierPartImportLink[] = [];
          // Item-level purchasing lead times. leadTimeForInserts is parallel to
          // itemInserts (filled in the insert branch); purchasingLeadTimes
          // collects the final {itemId, leadTime} entries once item ids are
          // known (immediately for updates, post-insert for new items).
          const leadTimeForInserts: Array<string | undefined> = [];
          const purchasingLeadTimes: ItemPurchasingLeadTime[] = [];
          // Same shape for the item-level planning order multiple. CSV's
          // "Order Multiple" column populates both supplierPart.orderMultiple
          // (per-supplier case-pack) and itemPlanning.orderMultiple
          // (per-(item, location) MRP setting) at import time.
          const orderMultipleForInserts: Array<string | undefined> = [];
          const itemPlanningOrderMultiples: ItemPlanningOrderMultiple[] = [];

          const itemValidator = z.object({
            id: z.string(),
            readableId: z.string(),
            revision: z.string().optional(),
            name: z.string(),
            description: z.string().optional(),
            active: z.string().optional(),
            unitOfMeasureCode: z.string().optional(),
            replenishmentSystem: z
              .enum(["Buy", "Make", "Buy and Make"])
              .optional(),
            defaultMethodType: z.enum(["Purchase to Order", "Make to Order", "Pull from Inventory"]).optional(),
            itemTrackingType: z.enum([
              "Inventory",
              "Non-Inventory",
              "Serial",
              "Batch",
            ]),
          });

          const materialValidator = itemValidator.extend({
            materialSubstanceId: z.string().optional(),
            materialFormId: z.string().optional(),
            finishId: z.string().optional(),
            dimensionId: z.string().optional(),
            gradeId: z.string().optional(),
          });

          for (const record of mappedRecords) {
            const item = itemValidator.safeParse(record);

            if (!item.success) {
              console.error(item.error.message);
              continue;
            }

            const { id, ...rest } = item.data;
            const readableIdWithRevision = getReadableIdWithRevision(
              item.data.readableId,
              item.data.revision
            );

            if (
              externalIdMap.has(getExternalId(id)) &&
              !readableIds.has(readableIdWithRevision)
            ) {
              const existingEntityId = externalIdMap.get(getExternalId(id))!;

              readableIds.add(readableIdWithRevision);
              itemUpdates.push({
                id: existingEntityId,
                data: {
                  ...rest,
                  revision: rest.revision ?? "0",
                  active: rest.active?.toLowerCase() !== "false" ?? true,
                  unitOfMeasureCode: rest.unitOfMeasureCode || undefined,
                  description: rest.description || undefined,
                  replenishmentSystem: rest.replenishmentSystem || undefined,
                  defaultMethodType: rest.defaultMethodType || undefined,
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                },
              });

              // Existing item: we already know its id, so the supplierPart
              // link can be queued directly.
              if (record.supplierId) {
                supplierPartLinks.push({
                  itemId: existingEntityId,
                  supplierId: record.supplierId,
                  supplierPartId: record.supplierPartId,
                  supplierUnitOfMeasureCode: record.supplierUnitOfMeasureCode,
                  minimumOrderQuantity: record.minimumOrderQuantity,
                  orderMultiple: record.orderMultiple,
                  conversionFactor: record.conversionFactor,
                  unitPrice: record.unitPrice,
                });
              }

              if (record.leadTime) {
                purchasingLeadTimes.push({
                  itemId: existingEntityId,
                  leadTime: record.leadTime,
                });
              }

              if (record.orderMultiple) {
                itemPlanningOrderMultiples.push({
                  itemId: existingEntityId,
                  orderMultiple: record.orderMultiple,
                });
              }

              if (table === "material") {
                const material = materialValidator.safeParse(record);
                if (material.success) {
                  materialUpdates.push({
                    id: material.data.readableId,
                    data: {
                      materialSubstanceId:
                        material.data.materialSubstanceId || undefined,
                      materialFormId: material.data.materialFormId || undefined,
                      dimensionId: material.data.dimensionId || undefined,
                      gradeId: material.data.gradeId || undefined,
                      finishId: material.data.finishId || undefined,
                      companyId,
                      updatedAt: new Date().toISOString(),
                      updatedBy: userId,
                    },
                  });
                }
              }
            } else if (!readableIds.has(readableIdWithRevision)) {
              readableIds.add(readableIdWithRevision);
              const newItem = {
                ...rest,
                replenishmentSystem: rest.replenishmentSystem ?? "Buy",
                active: rest.active?.toLowerCase() !== "false" ?? true,
                unitOfMeasureCode: rest.unitOfMeasureCode || undefined,
                description: rest.description || undefined,
                defaultMethodType: rest.defaultMethodType || undefined,
                type: capitalize(table) as
                  | "Part"
                  | "Service"
                  | "Material"
                  | "Tool"
                  | "Fixture"
                  | "Consumable",
                companyId,
                revision: rest.revision ?? "0",
                createdAt: new Date().toISOString(),
                createdBy: userId,
              };
              itemInserts.push(newItem);
              csvIdsForInserts.push(getExternalId(id));
              // New item: id will come back from the bulk insert. Capture
              // supplier-part data and lead time in parallel arrays so we can
              // build the link / lead-time entry once the id is known.
              supplierPartForInserts.push({
                supplierId: record.supplierId,
                supplierPartId: record.supplierPartId,
                supplierUnitOfMeasureCode: record.supplierUnitOfMeasureCode,
                minimumOrderQuantity: record.minimumOrderQuantity,
                orderMultiple: record.orderMultiple,
                conversionFactor: record.conversionFactor,
                unitPrice: record.unitPrice,
              });
              leadTimeForInserts.push(record.leadTime);
              orderMultipleForInserts.push(record.orderMultiple);

              if (table === "material") {
                const material = materialValidator.safeParse(record);
                if (!material.success) {
                  console.error(material.error.message);
                  continue;
                }
                if (material.success) {
                  materialPartialInserts[material.data.readableId!] = {
                    ...material.data,
                    id: material.data.readableId,
                    companyId,
                    createdAt: new Date().toISOString(),
                    createdBy: userId,
                  };
                }
              }
            }
          }

          if (itemInserts.length > 0) {
            const insertedItems = await trx
              .insertInto("item")
              .values(itemInserts)
              .onConflict((oc) =>
                oc.constraint("item_unique").doUpdateSet({
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                  name: sql`EXCLUDED."name"`,
                  description: sql`EXCLUDED."description"`,
                  active: sql`EXCLUDED."active"`,
                  unitOfMeasureCode: sql`EXCLUDED."unitOfMeasureCode"`,
                  replenishmentSystem: sql`EXCLUDED."replenishmentSystem"`,
                  defaultMethodType: sql`EXCLUDED."defaultMethodType"`,
                  itemTrackingType: sql`EXCLUDED."itemTrackingType"`,
                })
              )
              .returning(["id", "readableId"])
              .execute();

            await upsertCsvMappings(
              trx,
              "item",
              insertedItems.map((item, i) => ({
                entityId: item.id!,
                externalId: csvIdsForInserts[i],
              })),
              companyId,
              userId
            );

            if (["part", "fixture", "tool", "consumable"].includes(table)) {
              const specificInserts = insertedItems.map((item) => ({
                id: item.readableId,
                approved: true,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
              }));

              await trx
                .insertInto(table)
                .values(specificInserts as unknown as never)
                .execute();
            }

            if (
              table === "material" &&
              Object.keys(materialPartialInserts).length > 0
            ) {
              const materialInserts = insertedItems.reduce<
                Database["public"]["Tables"]["material"]["Insert"][]
              >((acc, item) => {
                const materialData = materialPartialInserts[item.readableId];
                if (materialData) {
                  acc.push({
                    id: item.readableId,
                    materialSubstanceId:
                      materialData.materialSubstanceId || undefined,
                    materialFormId: materialData.materialFormId || undefined,
                    dimensionId: materialData.dimensionId || undefined,
                    gradeId: materialData.gradeId || undefined,
                    finishId: materialData.finishId || undefined,
                    companyId,
                    createdAt: new Date().toISOString(),
                    createdBy: userId,
                  });
                }
                return acc;
              }, []);

              await trx
                .insertInto("material")
                .values(materialInserts)
                .execute();
            }

            // Build supplier-part links and lead-time entries for the items we
            // just inserted. supplierPartForInserts / leadTimeForInserts are
            // parallel to itemInserts; only rows with a supplier produce a
            // link, only rows with a lead time produce a lead-time entry.
            for (let i = 0; i < insertedItems.length; i++) {
              const sp = supplierPartForInserts[i];
              if (sp?.supplierId && insertedItems[i].id) {
                supplierPartLinks.push({
                  itemId: insertedItems[i].id!,
                  supplierId: sp.supplierId,
                  supplierPartId: sp.supplierPartId,
                  supplierUnitOfMeasureCode: sp.supplierUnitOfMeasureCode,
                  minimumOrderQuantity: sp.minimumOrderQuantity,
                  orderMultiple: sp.orderMultiple,
                  conversionFactor: sp.conversionFactor,
                  unitPrice: sp.unitPrice,
                });
              }
              const leadTime = leadTimeForInserts[i];
              if (leadTime && insertedItems[i].id) {
                purchasingLeadTimes.push({
                  itemId: insertedItems[i].id!,
                  leadTime,
                });
              }
              const orderMultiple = orderMultipleForInserts[i];
              if (orderMultiple && insertedItems[i].id) {
                itemPlanningOrderMultiples.push({
                  itemId: insertedItems[i].id!,
                  orderMultiple,
                });
              }
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            itemInserts: itemInserts.length,
            itemUpdates: itemUpdates.length,
            materialInserts: Object.keys(materialPartialInserts).length,
            materialUpdates: materialUpdates.length,
          });

          if (itemUpdates.length > 0) {
            const currentItems = await trx
              .selectFrom("item")
              .select(["id", "readableId"])
              .where(
                "id",
                "in",
                itemUpdates.map((u) => u.id)
              )
              .execute();
            const currentReadableIdMap = new Map(
              currentItems.map((i) => [i.id, i.readableId])
            );

            for (const update of itemUpdates) {
              await trx
                .updateTable("item")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }

            for (const update of itemUpdates) {
              const oldReadableId = currentReadableIdMap.get(update.id);
              const newReadableId = update.data.readableId;
              if (
                newReadableId &&
                oldReadableId &&
                oldReadableId !== newReadableId
              ) {
                await trx
                  .updateTable(table)
                  .set({ id: newReadableId } as never)
                  .where("id", "=", oldReadableId)
                  .where("companyId", "=", companyId)
                  .execute();
              }
            }

            if (materialUpdates.length > 0) {
              for (const update of materialUpdates) {
                await trx
                  .updateTable("material")
                  .set(update.data)
                  .where("id", "=", update.id)
                  .execute();
              }
            }
          }

          await writeSupplierPartLinks(
            trx,
            supplierPartLinks,
            companyId,
            userId
          );

          await writeItemPurchasingLeadTimes(
            trx,
            purchasingLeadTimes,
            companyId,
            userId
          );

          await writeItemPlanningOrderMultiples(
            trx,
            itemPlanningOrderMultiples,
            companyId,
            userId
          );
        });

        break;
      }
      case "customerContact": {
        const externalContactIdMap = await getCsvExternalIdMap(
          "contact",
          companyId
        );
        const externalCustomerIdMap = await getCsvExternalIdMap(
          "customer",
          companyId
        );

        await db.transaction().execute(async (trx) => {
          const contactInserts: Database["public"]["Tables"]["contact"]["Insert"][] =
            [];
          const csvIdsForContactInserts: string[] = [];
          const contactUpdates: {
            id: string;
            data: Database["public"]["Tables"]["contact"]["Update"];
          }[] = [];
          const customerContactInserts: Database["public"]["Tables"]["customerContact"]["Insert"][] =
            [];

          const isContactValid = (
            record: Record<string, string>
          ): record is {
            email: string;
          } => {
            return (
              typeof record.email === "string" && record.email.trim() !== ""
            );
          };

          for (const record of mappedRecords) {
            const { id, companyId: customerId, ...contactData } = record;

            if (externalContactIdMap.has(id)) {
              const existingEntityId = externalContactIdMap.get(id)!;
              if (isContactValid(contactData)) {
                contactUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...contactData,
                  },
                });
              }
            } else if (
              isContactValid(contactData) &&
              externalCustomerIdMap.has(customerId)
            ) {
              const existingCustomerId = externalCustomerIdMap.get(customerId)!;
              const contactId = nanoid();
              const newContact = {
                id: contactId,
                ...contactData,
                companyId,
              };

              contactInserts.push(newContact);
              csvIdsForContactInserts.push(id);
              customerContactInserts.push({
                contactId,
                customerId: existingCustomerId,
                customFields: {},
              });
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            contactInserts: contactInserts.length,
            contactUpdates: contactUpdates.length,
            customerContactInserts: customerContactInserts.length,
          });

          if (contactInserts.length > 0) {
            const inserted = await trx
              .insertInto("contact")
              .values(contactInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "contact",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForContactInserts[i],
              })),
              companyId,
              userId
            );
          }

          if (contactUpdates.length > 0) {
            for (const update of contactUpdates) {
              await trx
                .updateTable("contact")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
          }

          if (customerContactInserts.length > 0) {
            await trx
              .insertInto("customerContact")
              .values(customerContactInserts)
              .execute();
          }
        });

        break;
      }
      case "supplierContact": {
        const externalContactIdMap = await getCsvExternalIdMap(
          "contact",
          companyId
        );
        const externalSupplierIdMap = await getCsvExternalIdMap(
          "supplier",
          companyId
        );

        await db.transaction().execute(async (trx) => {
          const contactInserts: Database["public"]["Tables"]["contact"]["Insert"][] =
            [];
          const csvIdsForContactInserts: string[] = [];
          const contactUpdates: {
            id: string;
            data: Database["public"]["Tables"]["contact"]["Update"];
          }[] = [];
          const supplierContactInserts: Database["public"]["Tables"]["supplierContact"]["Insert"][] =
            [];

          const isContactValid = (
            record: Record<string, string>
          ): record is {
            email: string;
          } => {
            return (
              typeof record.email === "string" && record.email.trim() !== ""
            );
          };

          for (const record of mappedRecords) {
            const { id, companyId: supplierId, ...contactData } = record;

            if (externalContactIdMap.has(id)) {
              const existingEntityId = externalContactIdMap.get(id)!;
              if (isContactValid(contactData)) {
                contactUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...contactData,
                  },
                });
              }
            } else if (
              isContactValid(contactData) &&
              externalSupplierIdMap.has(supplierId)
            ) {
              const existingSupplierId = externalSupplierIdMap.get(supplierId)!;
              const contactId = nanoid();
              const newContact = {
                id: contactId,
                ...contactData,
                companyId,
              };
              contactInserts.push(newContact);
              csvIdsForContactInserts.push(id);
              supplierContactInserts.push({
                contactId,
                supplierId: existingSupplierId,
                customFields: {},
              });
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            contactInserts: contactInserts.length,
            contactUpdates: contactUpdates.length,
            supplierContactInserts: supplierContactInserts.length,
          });

          if (contactInserts.length > 0) {
            const inserted = await trx
              .insertInto("contact")
              .values(contactInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "contact",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForContactInserts[i],
              })),
              companyId,
              userId
            );
          }

          if (contactUpdates.length > 0) {
            for (const update of contactUpdates) {
              await trx
                .updateTable("contact")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
          }

          if (supplierContactInserts.length > 0) {
            await trx
              .insertInto("supplierContact")
              .values(supplierContactInserts)
              .execute();
          }
        });

        break;
      }
      case "workCenter": {
        const externalIdMap = await getCsvExternalIdMap(
          "workCenter",
          companyId
        );
        const workCenterIds = new Set();

        await db.transaction().execute(async (trx) => {
          const workCenterInserts: Database["public"]["Tables"]["workCenter"]["Insert"][] =
            [];
          const csvIdsForInserts: string[] = [];
          const workCenterUpdates: {
            id: string;
            data: Database["public"]["Tables"]["workCenter"]["Update"];
          }[] = [];

          const isWorkCenterValid = (
            record: Record<string, string>
          ): record is { name: string; locationId: string } => {
            return (
              typeof record.name === "string" &&
              record.name.trim() !== "" &&
              typeof record.locationId === "string" &&
              record.locationId.trim() !== ""
            );
          };

          for (const record of mappedRecords) {
            const { id, ...rest } = record;
            if (externalIdMap.has(id)) {
              const existingEntityId = externalIdMap.get(id)!;
              if (isWorkCenterValid(rest) && !workCenterIds.has(id)) {
                workCenterIds.add(id);
                workCenterUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...rest,
                    laborRate: rest.laborRate ? parseFloat(rest.laborRate) : 0,
                    machineRate: rest.machineRate
                      ? parseFloat(rest.machineRate)
                      : 0,
                    overheadRate: rest.overheadRate
                      ? parseFloat(rest.overheadRate)
                      : 0,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                  },
                });
              }
            } else if (isWorkCenterValid(rest) && !workCenterIds.has(id)) {
              workCenterIds.add(id);
              workCenterInserts.push({
                ...rest,
                laborRate: rest.laborRate ? parseFloat(rest.laborRate) : 0,
                machineRate: rest.machineRate
                  ? parseFloat(rest.machineRate)
                  : 0,
                overheadRate: rest.overheadRate
                  ? parseFloat(rest.overheadRate)
                  : 0,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
              } as never);
              csvIdsForInserts.push(id);
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            workCenterInserts: workCenterInserts.length,
            workCenterUpdates: workCenterUpdates.length,
          });

          if (workCenterInserts.length > 0) {
            const inserted = await trx
              .insertInto("workCenter")
              .values(workCenterInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "workCenter",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForInserts[i],
              })),
              companyId,
              userId
            );
          }
          if (workCenterUpdates.length > 0) {
            for (const update of workCenterUpdates) {
              await trx
                .updateTable("workCenter")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
          }
        });
        break;
      }
      case "process": {
        const externalIdMap = await getCsvExternalIdMap("process", companyId);
        const processIds = new Set();

        await db.transaction().execute(async (trx) => {
          const processInserts: Database["public"]["Tables"]["process"]["Insert"][] =
            [];
          const csvIdsForInserts: string[] = [];
          const processUpdates: {
            id: string;
            data: Database["public"]["Tables"]["process"]["Update"];
          }[] = [];

          const isProcessValid = (
            record: Record<string, string>
          ): record is { name: string; processType: string } => {
            return (
              typeof record.name === "string" &&
              record.name.trim() !== "" &&
              typeof record.processType === "string" &&
              (record.processType === "Inside" ||
                record.processType === "Outside")
            );
          };

          for (const record of mappedRecords) {
            const { id, ...rest } = record;
            if (externalIdMap.has(id)) {
              const existingEntityId = externalIdMap.get(id)!;
              if (isProcessValid(rest) && !processIds.has(id)) {
                processIds.add(id);
                processUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...rest,
                    completeAllOnScan:
                      rest.completeAllOnScan?.toLowerCase() === "true" ?? false,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                  },
                });
              }
            } else if (isProcessValid(rest) && !processIds.has(id)) {
              processIds.add(id);
              processInserts.push({
                ...rest,
                completeAllOnScan:
                  rest.completeAllOnScan?.toLowerCase() === "true" ?? false,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
              } as never);
              csvIdsForInserts.push(id);
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            processInserts: processInserts.length,
            processUpdates: processUpdates.length,
          });

          if (processInserts.length > 0) {
            const inserted = await trx
              .insertInto("process")
              .values(processInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "process",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForInserts[i],
              })),
              companyId,
              userId
            );
          }
          if (processUpdates.length > 0) {
            for (const update of processUpdates) {
              await trx
                .updateTable("process")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
          }
        });
        break;
      }
      case "methodMaterial": {
        throw new Error("Not implemented");
      }
      default: {
        throw new Error(`Invalid table: ${table}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
