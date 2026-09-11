import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExternalIntegrationMapping,
  ExternalIntegrationMappingService
} from "../../accounting/core/external-mapping";
import { buildRampIdempotencyKey, type RampClient } from "./client";
import { RAMP } from "./connection";
import type { RampVendor } from "./models";

// /********************************************************\
// *          Outbound push (POs, draft bills)             *
// \********************************************************/

// Release gate, intentionally not a customer setting or environment override.
// Existing installs commonly have pushInvoices=true. Enable only after the
// draft body's monetary units/coding/PDF fields and submit's returned identity
// are verified and pinned by contract tests. PO push and bill archive are separate.
const RAMP_DRAFT_BILL_CONTRACT_VERIFIED = false;

/** A Carbon purchase-order line, shaped for a Ramp PO push. */
export type RampPurchaseOrderPushLine = {
  id: string;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
};

/** The Carbon purchase order the job hands to {@link pushPurchaseOrder}. */
export type RampPurchaseOrderPush = {
  /** Carbon `purchaseOrder.id` (the mapping's entityId + the PO `external_id`). */
  id: string;
  /** Human-readable `purchaseOrder.purchaseOrderId` → Ramp `purchase_order_number`. */
  readableId: string;
  status: Database["public"]["Enums"]["purchaseOrderStatus"];
  supplier: RampVendorSupplier;
  /** The PO currency → Ramp's required `currency` (job falls back to base). */
  currencyCode: string | null;
  /** Ramp's required `entity_id` — the job resolves it before the push. */
  entityId?: string;
  lines: RampPurchaseOrderPushLine[];
};

/** A Carbon purchase-invoice line, shaped for a Ramp draft-bill push. */
export type RampInvoicePushLine = {
  description: string | null;
  amount: number;
};

/** The Carbon purchase invoice the job hands to {@link pushInvoiceDraftBill}. */
export type RampInvoicePush = {
  /** Carbon `purchaseInvoice.id` (the mapping's entityId + the bill `remote_id`). */
  id: string;
  /** Human-readable `purchaseInvoice.invoiceId` (the fallback invoice number). */
  readableId: string;
  supplierReference: string | null;
  currencyCode: string | null;
  dateIssued: string | null;
  dateDue: string | null;
  lines: RampInvoicePushLine[];
};

/**
 * Ensure a Ramp accounting vendor exists for a Carbon supplier — OUTBOUND
 * direction, so the mapping is read Carbon→Ramp via `getExternalId("vendor", …)`
 * (NOT the inbound `getEntityId`). Reuses an existing mapping (including one an
 * inbound bill/reimbursement already linked); otherwise creates a Ramp vendor
 * from the supplier name and links it (`allowDuplicateExternalId` default).
 * Returns the Ramp vendor id, or `null` when the supplier has no usable name.
 */
/**
 * A Carbon supplier resolved with the contact + address a Ramp SPEND vendor
 * needs. `country` (alpha-2, from the supplier's primary `address.countryCode`)
 * and a `contact.email` are what `POST /vendors` requires to CREATE one; without
 * both, only matching an existing Ramp vendor is possible.
 */
export type RampVendorSupplier = {
  id: string;
  name: string | null;
  country: string | null;
  contact: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  } | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    stateProvince: string | null;
    postalCode: string | null;
  } | null;
};

/** First Ramp spend vendor matching a filter (`external_vendor_id` or `name`), or null. */
async function findRampSpendVendor(
  client: RampClient,
  params: { external_vendor_id?: string; name?: string }
): Promise<RampVendor | null> {
  for await (const page of client.listVendors(params)) {
    if (page.length > 0) return page[0] ?? null;
  }
  return null;
}

/**
 * The single Ramp spend vendor whose name EXACTLY (case-insensitively) matches
 * `name`, or null when there is none — OR more than one. A vendor name is not an
 * identity key: two Ramp vendors can share one, and binding a Carbon supplier to
 * an arbitrary same-named vendor would push its bills under the wrong Ramp
 * vendor. An ambiguous name therefore falls through to a create instead of
 * linking.
 */
async function findUniqueRampSpendVendorByName(
  client: RampClient,
  name: string
): Promise<RampVendor | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  let match: RampVendor | null = null;
  for await (const page of client.listVendors({ name })) {
    for (const vendor of page) {
      if ((vendor.name ?? "").trim().toLowerCase() !== target) continue;
      if (match) return null; // more than one exact match → ambiguous
      match = vendor;
    }
  }
  return match;
}

/**
 * Resolve the Ramp SPEND-vendor id a PO/bill `vendor_id` needs for a Carbon
 * supplier — matching first, creating only as a last resort (option B):
 *
 * 1. an existing `("vendor", supplier.id, "ramp")` mapping,
 * 2. a Ramp vendor already carrying our `external_vendor_id`,
 * 3. a Ramp vendor whose name matches exactly (case-insensitive) — links to a
 *    pre-existing spend vendor instead of duplicating it,
 * 4. otherwise CREATE one (`POST /vendors`) with the supplier's synced contact
 *    email + country (+ address when present) and `external_vendor_id`.
 *
 * Returns `null` (never throws) when the supplier has no name, or has no
 * matching vendor AND lacks the email/country a create requires — the caller
 * decides (a PO omits the optional `vendor_id`; a bill, which requires one, is
 * skipped). Accounting vendors (`/accounting/vendors`, for coding) are a
 * DIFFERENT id space Ramp rejects here — do not use them.
 */
export async function resolveOrCreateRampSpendVendor(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  supplier: RampVendorSupplier,
  companyId?: string
): Promise<string | null> {
  const existing = await mapping.getExternalId("vendor", supplier.id, RAMP);
  if (existing) return existing;

  const name = (supplier.name ?? "").trim();
  if (!name) return null;

  // Prefer an exact identity match on our own external_vendor_id. Fall back to a
  // name match ONLY when it is unambiguous — exactly one Ramp vendor carries
  // this exact (case-insensitive) name — since a shared name is not an identity
  // key and would otherwise link this supplier to the wrong Ramp vendor.
  const byExternal = await findRampSpendVendor(client, {
    external_vendor_id: supplier.id
  });
  const matched =
    byExternal ?? (await findUniqueRampSpendVendorByName(client, name));
  if (matched?.id) {
    await mapping.link("vendor", supplier.id, RAMP, matched.id, {
      createdBy: "system"
    });
    return matched.id;
  }

  // Create — Ramp requires a country and at least one contact email (and, for
  // US, a two-letter state). Best-effort: a create that Ramp rejects (missing
  // state, bad data) returns null rather than throwing, so a PO still pushes
  // without a vendor and a bill is skipped rather than crashing the family.
  const email = supplier.contact?.email?.trim();
  const country = supplier.country?.trim();
  if (!email || !country) return null;

  const { contact, address } = supplier;
  // `business_vendor_contacts` is a SINGLE object despite the plural name
  // (OpenAPI `allOf` of one contact schema — an array is rejected "Invalid input
  // type"). `state` is required for US and lives at the vendor top level.
  let created: { id?: string } | null;
  try {
    created = (await client.createSpendVendor(
      {
        name,
        country,
        ...(address?.stateProvince ? { state: address.stateProvince } : {}),
        external_vendor_id: supplier.id,
        business_vendor_contacts: {
          email,
          ...(contact?.firstName ? { first_name: contact.firstName } : {}),
          ...(contact?.lastName ? { last_name: contact.lastName } : {}),
          ...(contact?.phone ? { phone: contact.phone } : {})
        },
        ...(address?.line1 && address.city && address.postalCode
          ? {
              address: {
                address_line_1: address.line1,
                ...(address.line2 ? { address_line_2: address.line2 } : {}),
                city: address.city,
                postal_code: address.postalCode,
                ...(address.stateProvince
                  ? { state: address.stateProvince }
                  : {}),
                country
              }
            }
          : {})
      },
      // Entity-scoped idempotency key (keyed on the Carbon supplier id) so a
      // retried push cannot create a duplicate Ramp spend vendor. Only when the
      // caller supplied a companyId (the helper needs it to derive the key).
      companyId
        ? buildRampIdempotencyKey({
            companyId,
            operation: "createSpendVendor",
            scope: supplier.id
          })
        : undefined
    )) as { id?: string } | null;
  } catch (createError) {
    console.error(
      `[RAMP] failed to create Ramp spend vendor for supplier "${name}" (${supplier.id})`,
      createError
    );
    return null;
  }

  const rampVendorId = created?.id ?? null;
  if (!rampVendorId) return null;

  await mapping.link("vendor", supplier.id, RAMP, rampVendorId, {
    createdBy: "system"
  });
  return rampVendorId;
}

/**
 * Push one Carbon purchase order to Ramp. Completed/Closed POs that already have
 * a Ramp mapping are archived; every other (released) PO resolves its Ramp SPEND
 * vendor (matched or created — best-effort, since `vendor_id` is optional), then
 * either PATCHes an existing Ramp PO or creates a new one carrying
 * `external_id: po.id` so Ramp's bill-matching flow can find the Carbon PO. The
 * new Ramp PO id is linked under `("purchaseOrder", po.id, "ramp")`.
 * Ramp requires `currency`, `entity_id`, and `three_way_match_enabled` on create.
 */
export async function pushPurchaseOrder(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  po: RampPurchaseOrderPush,
  companyId?: string
): Promise<"created" | "patched" | "archived" | "skipped"> {
  const existingRampPoId = await mapping.getExternalId(
    "purchaseOrder",
    po.id,
    RAMP
  );

  // Completed / Closed POs with a mapping → archive; without one → nothing to do.
  if (po.status === "Completed" || po.status === "Closed") {
    if (existingRampPoId) {
      await client.archivePurchaseOrder(existingRampPoId);
      return "archived";
    }
    return "skipped";
  }

  // Best-effort: match/create the Ramp SPEND vendor. `vendor_id` is OPTIONAL on
  // a PO (Ramp still matches its bill by `external_id`), so a supplier we can't
  // resolve/create does not block the push.
  const rampVendorId = await resolveOrCreateRampSpendVendor(
    mapping,
    client,
    po.supplier,
    companyId
  );

  const lineItems = po.lines.map((line) => ({
    description: line.description ?? "",
    unit_quantity: line.quantity ?? 0,
    unit_price: line.unitPrice ?? 0,
    external_id: line.id
  }));

  if (existingRampPoId) {
    await client.patchPurchaseOrder(existingRampPoId, {
      ...(rampVendorId ? { vendor_id: rampVendorId } : {}),
      line_items: lineItems
    });
    return "patched";
  }

  const created = (await client.createPurchaseOrder(
    {
      purchase_order_number: po.readableId,
      external_id: po.id,
      three_way_match_enabled: false,
      ...(po.currencyCode ? { currency: po.currencyCode } : {}),
      ...(po.entityId ? { entity_id: po.entityId } : {}),
      ...(rampVendorId ? { vendor_id: rampVendorId } : {}),
      line_items: lineItems
    },
    // Entity-scoped idempotency key (keyed on the Carbon purchase-order id) so a
    // retried push cannot create a duplicate Ramp PO. Only when the caller
    // supplied a companyId (the helper needs it to derive the key).
    companyId
      ? buildRampIdempotencyKey({
          companyId,
          operation: "createPurchaseOrder",
          scope: po.id
        })
      : undefined
  )) as { id?: string } | null;
  const rampPoId = created?.id ?? null;
  if (!rampPoId) {
    throw new Error(
      `Ramp did not return a purchase order id for ${po.readableId}`
    );
  }

  await mapping.link("purchaseOrder", po.id, RAMP, rampPoId, {
    createdBy: "system"
  });
  return "created";
}

/**
 * Push one posted Carbon purchase invoice to Ramp as a DRAFT bill, then SUBMIT it
 * (draft + submit only — submit lands the bill in Ramp "Pending approval"; an
 * auto-approved `POST /bills` is never used). Ensures the Ramp vendor, creates the
 * draft with `remote_id: invoice.id`, best-effort attaches the invoice PDF when one
 * exists in storage (silently skipped when absent), submits, and links
 * `("bill", invoice.id, "ramp", <submitted id>)`.
 *
 * The CALLER filters candidates (no existing `("bill")` mapping in either
 * direction, not an Employee-supplier reimbursement, view-status Open/Partially
 * Paid). Returns `"pushed"` or `"skipped"` (vendor without a name).
 * Currently fails closed at the release gate before any vendor/document/provider
 * I/O; the caller must retain this invoice's cursor position for a future retry.
 */
export async function pushInvoiceDraftBill(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  invoice: RampInvoicePush & { supplier: RampVendorSupplier }
): Promise<"pushed" | "skipped"> {
  if (!RAMP_DRAFT_BILL_CONTRACT_VERIFIED) {
    throw new Error(
      "Ramp draft-bill export is disabled until its API contract is verified"
    );
  }
  // A bill REQUIRES a `vendor_id`, so a supplier we can't match/create a Ramp
  // spend vendor for is skipped (needs a name, and to create: an email + country).
  const rampVendorId = await resolveOrCreateRampSpendVendor(
    mapping,
    client,
    invoice.supplier,
    companyId
  );
  if (!rampVendorId) return "skipped";

  // Best-effort PDF attach: locate the invoice's PDF document, sign a short-lived
  // URL. Skipped silently when the invoice has no PDF in storage.
  let documentUrls: string[] | undefined;
  const pdf = await serviceRole
    .from("document")
    .select("path")
    .eq("companyId", companyId)
    .eq("sourceDocumentId", invoice.id)
    .eq("type", "PDF")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pdf.data?.path) {
    const signed = await serviceRole.storage
      .from("private")
      .createSignedUrl(pdf.data.path, 3600);
    if (signed.data?.signedUrl) documentUrls = [signed.data.signedUrl];
  }

  const invoiceNumber =
    (invoice.supplierReference ?? "").trim() || invoice.readableId;

  // TODO(task-1): confirm the POST /bills/drafts body — line_items shape (amount
  // as minor units vs decimal, accounting_field_selections) and the PDF-attach
  // field name (document_urls here is a placeholder).
  const created = (await client.createDraftBill(
    {
      vendor_id: rampVendorId,
      invoice_number: invoiceNumber,
      ...(invoice.currencyCode
        ? { invoice_currency: invoice.currencyCode }
        : {}),
      ...(invoice.dateIssued ? { issued_at: invoice.dateIssued } : {}),
      ...(invoice.dateDue ? { due_at: invoice.dateDue } : {}),
      remote_id: invoice.id,
      ...(documentUrls ? { document_urls: documentUrls } : {}),
      line_items: invoice.lines.map((line) => ({
        memo: line.description ?? undefined,
        amount: line.amount
      }))
    },
    // Entity-scoped idempotency key (keyed on the Carbon purchase-invoice id) so a
    // retried push cannot create a duplicate draft bill at Ramp.
    buildRampIdempotencyKey({
      companyId,
      operation: "createDraftBill",
      scope: invoice.id
    })
  )) as { id?: string } | null;
  const draftId = created?.id ?? null;
  if (!draftId) {
    throw new Error(
      `Ramp did not return a draft-bill id for invoice ${invoice.readableId}`
    );
  }

  // TODO(task-1): confirm whether submit returns the draft id or a promoted bill
  // id; store WHICH id the submit returns (falls back to the draft id).
  const submitted = (await client.submitDraftBill(
    draftId,
    // Entity-scoped idempotency key (keyed on the Ramp draft-bill id) so a retried
    // submit cannot promote/duplicate the bill twice at Ramp.
    buildRampIdempotencyKey({
      companyId,
      operation: "submitDraftBill",
      scope: draftId
    })
  )) as {
    id?: string;
  } | null;
  const billId = submitted?.id ?? draftId;

  await mapping.link("bill", invoice.id, RAMP, billId, {
    createdBy: "system"
  });
  return "pushed";
}

/**
 * Archive a pushed Ramp bill once its Carbon invoice has settled (view-status
 * Paid/Voided). Only a successful provider response stamps `archived: true`
 * onto the mapping metadata (preserving e.g. `rampPaid`). Errors propagate so
 * the caller can report failure and retry; neither a 404 nor error wording
 * proves the bill was archived or settled.
 * The CALLER decides which mappings are eligible (settled + not yet archived).
 */
export async function archiveRampBillForInvoice(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  mappingRow: ExternalIntegrationMapping
): Promise<void> {
  await client.archiveBill(mappingRow.externalId);

  await mapping.link("bill", mappingRow.entityId, RAMP, mappingRow.externalId, {
    createdBy: mappingRow.createdBy ?? "system",
    metadata: { ...(mappingRow.metadata ?? {}), archived: true }
  });
}
