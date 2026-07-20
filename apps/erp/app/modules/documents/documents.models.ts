import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { itemType } from "~/modules/shared";

const logger = getLogger("erp", "documents-models");

export const documentSourceTypes = [
  "Job",
  "Gauge Calibration Record",
  "Issue",
  "Purchase Order",
  "Purchase Invoice",
  "Quote",
  "Request for Quote",
  "Purchasing Request for Quote",
  "Supplier Quote",
  "Sales Order",
  "Sales Invoice",
  "Shipment",
  ...itemType
] as const;

export const documentValidator = z.object({
  id: z.string().min(1, { message: "Document ID is required" }),
  name: z.string().min(3).max(50),
  extension: z.string().optional(),
  description: z.string().optional(),
  labels: z.array(z.string().min(1).max(50)).optional(),
  readGroups: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .min(1, { message: "Read permissions are required" }),
  writeGroups: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .min(1, { message: "Write permissions are required" })
});

export const documentLabelsValidator = z.object({
  documentId: z.string().min(20),
  labels: z.array(z.string().min(1).max(50)).optional()
});

// -- PDF document extraction --------------------------------------------------
//
// Client-side contract for the *filtered* document-extraction payload.
//
// The extraction job (`packages/jobs/src/inngest/functions/extraction/`) emits
// each field wrapped as `{ value, confidence }`, then collapses it to a plain
// value (or null, below the confidence threshold) into
// `documentExtraction.filteredData`. These schemas describe that collapsed shape
// as the UI consumes it.
//
// IMPORTANT: field names MUST stay in sync with the extraction schemas in
// `packages/jobs/src/inngest/functions/extraction/schemas.ts`. The two packages
// cannot share an import today; a shared package is a future consolidation.

// Every filtered field is a plain, possibly-null value that may also be absent.
const str = z.string().nullable().optional();
const num = z.number().nullable().optional();

const salesRfqLineItemSchema = z.object({
  partNumber: str,
  description: str,
  quantity: num
});

export const salesRfqExtractionSchema = z.object({
  // AI-resolved id of a matching record (or null when nothing matched).
  customerId: str,
  customerName: str,
  purchasingContactName: str,
  purchasingContactEmail: str,
  purchasingContactPhone: str,
  engineeringContactName: str,
  engineeringContactEmail: str,
  engineeringContactPhone: str,
  customerAddressLine1: str,
  customerAddressLine2: str,
  customerCity: str,
  customerStateProvince: str,
  customerPostalCode: str,
  customerCountry: str,
  rfqNumber: str,
  rfqDate: str,
  dueDate: str,
  requestedDeliveryDate: str,
  lineItems: z.array(salesRfqLineItemSchema).optional()
});

const purchaseInvoiceLineItemSchema = z.object({
  partNumber: str,
  description: str,
  quantity: num,
  unitPrice: num,
  totalPrice: num
});

export const purchaseInvoiceExtractionSchema = z.object({
  // AI-resolved ids of matching records (or null when nothing matched).
  supplierId: str,
  paymentTermId: str,
  supplierName: str,
  supplierContactName: str,
  supplierContactEmail: str,
  supplierContactPhone: str,
  supplierAddressLine1: str,
  supplierAddressLine2: str,
  supplierCity: str,
  supplierStateProvince: str,
  supplierPostalCode: str,
  supplierCountry: str,
  invoiceNumber: str,
  invoiceDate: str,
  dueDate: str,
  paymentTerms: str,
  purchaseOrderNumber: str,
  currencyCode: str,
  subtotal: num,
  taxAmount: num,
  shippingCost: num,
  totalAmount: num,
  lineItems: z.array(purchaseInvoiceLineItemSchema).optional()
});

export type DocumentExtractionType = "purchaseInvoice" | "salesRfq";

export type SalesRfqExtraction = z.infer<typeof salesRfqExtractionSchema>;
export type PurchaseInvoiceExtraction = z.infer<
  typeof purchaseInvoiceExtractionSchema
>;
export type SalesRfqLineItem = z.infer<typeof salesRfqLineItemSchema>;
export type PurchaseInvoiceLineItem = z.infer<
  typeof purchaseInvoiceLineItemSchema
>;

/** Storage path of the source PDF, threaded alongside the extracted fields. */
type WithStoragePath = { _storagePath?: string | null };

/** The payload handed to a form's auto-fill handler once extraction completes. */
export type ExtractedDocumentData =
  | (SalesRfqExtraction & WithStoragePath)
  | (PurchaseInvoiceExtraction & WithStoragePath);

/**
 * Validate a raw `filteredData` blob against the schema for its document type.
 * Returns the typed data, or `null` if the shape is unexpected (logged, never throws).
 */
export function parseExtractedData(
  documentType: DocumentExtractionType,
  filteredData: unknown
): ExtractedDocumentData | null {
  const schema =
    documentType === "salesRfq"
      ? salesRfqExtractionSchema
      : purchaseInvoiceExtractionSchema;
  const result = schema.safeParse(filteredData);
  if (!result.success) {
    logger.warning(
      `Unexpected ${documentType} extraction payload`,
      result.error.flatten()
    );
    return null;
  }
  return result.data;
}

// -- Shared auto-fill matchers -------------------------------------------------
// Pure helpers used by the per-form auto-fill hooks. Kept here (client-safe, no
// server imports) so both the sales and purchasing flows share one implementation.

/** Split a full name into first/last on the first space (extracted-name convention). */
export function splitContactName(fullName?: string | null): {
  firstName: string;
  lastName: string;
} {
  const parts = (fullName ?? "").split(" ");
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export type ExtractionContactRow = {
  id: string;
  contact: { fullName: string | null; email: string | null } | null;
};

/** Match an extracted contact to an existing one by exact email or full name (case-insensitive). */
export function findMatchingContactId(
  contacts: ExtractionContactRow[],
  search: { name?: string | null; email?: string | null }
): string | undefined {
  const nameLower = search.name?.trim().toLowerCase();
  const emailLower = search.email?.trim().toLowerCase();
  if (!nameLower && !emailLower) return undefined;

  return contacts.find((c) => {
    const dbEmail = c.contact?.email?.trim().toLowerCase();
    const dbName = c.contact?.fullName?.trim().toLowerCase();
    if (emailLower && dbEmail === emailLower) return true;
    if (nameLower && dbName === nameLower) return true;
    return false;
  })?.id;
}

export type ExtractionLocationRow = {
  id: string;
  address: { addressLine1: string | null } | null;
};

/**
 * Fetch the existing contacts and locations for a customer/supplier so the
 * auto-fill hooks can match extracted values against them. The two entity
 * families share an identical shape, so this collapses the duplicate fetch (and
 * the accompanying casts) into one place.
 */
export async function getExtractionMatchCandidates(
  carbon: SupabaseClient<Database>,
  entity: "customer" | "supplier",
  entityId: string
): Promise<{
  contacts: ExtractionContactRow[];
  locations: ExtractionLocationRow[];
}> {
  const [contactResult, locationResult] = await Promise.all([
    carbon
      // Cast the dynamic table/column names to a concrete literal; the customer
      // and supplier variants have identical column shapes at runtime.
      .from(`${entity}Contact` as "customerContact")
      .select("id, contact(id, fullName, email)")
      .eq(`${entity}Id` as "customerId", entityId),
    carbon
      .from(`${entity}Location` as "customerLocation")
      .select("id, address(id, addressLine1)")
      .eq(`${entity}Id` as "customerId", entityId)
  ]);

  return {
    contacts: (contactResult.data ?? []) as unknown as ExtractionContactRow[],
    locations: (locationResult.data ?? []) as unknown as ExtractionLocationRow[]
  };
}

/** Match an extracted address to an existing location by substring inclusion (either direction). */
export function findMatchingLocationId(
  locations: ExtractionLocationRow[],
  addressLine1?: string | null
): string | undefined {
  const addressLower = addressLine1?.trim().toLowerCase();
  if (!addressLower) return undefined;

  return locations.find((l) => {
    const dbAddress = l.address?.addressLine1?.trim().toLowerCase();
    if (!dbAddress) return false;
    return addressLower.includes(dbAddress) || dbAddress.includes(addressLower);
  })?.id;
}
