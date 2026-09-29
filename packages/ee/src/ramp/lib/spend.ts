import type { ExternalIntegrationMappingService } from "../../accounting/core/external-mapping";
import type { SpendVendorParty } from "../../spend/parties";
import { buildRampIdempotencyKey, type RampClient } from "./client";
import { RAMP } from "./connection";
import type { RampVendor } from "./models";

// /********************************************************\
// *        Ramp spend-vendor resolution (outbound)        *
// \********************************************************/

/**
 * Alias of the shared `SpendVendorParty` — one definition of "the Carbon
 * supplier identity a spend platform needs", loaded by `spend/parties.ts`. Kept
 * under the Ramp name because it is this module's public contract.
 */
export type RampVendorSupplier = SpendVendorParty;

export type RampPurchaseOrderBatch = {
  purchaseOrderIds: Map<string, string>;
  vendorIds: Map<string, string>;
  vendorsByExternalId: Map<string, RampVendor>;
  vendorsByName: Map<string, RampVendor | null>;
  vendorLookup: { ok: true } | { ok: false; error: unknown };
};

function indexSpendVendor(batch: RampPurchaseOrderBatch, vendor: RampVendor) {
  if (
    typeof vendor.external_vendor_id === "string" &&
    !batch.vendorsByExternalId.has(vendor.external_vendor_id)
  ) {
    batch.vendorsByExternalId.set(vendor.external_vendor_id, vendor);
  }
  const name = (vendor.name ?? "").trim().toLowerCase();
  if (name)
    batch.vendorsByName.set(
      name,
      batch.vendorsByName.has(name) ? null : vendor
    );
}

/** One mapping read per entity kind and one paginated provider snapshot per PO page. */
export async function prepareRampPurchaseOrderBatch(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  purchaseOrderIds: string[],
  suppliers: RampVendorSupplier[]
): Promise<RampPurchaseOrderBatch> {
  const uniqueSuppliers = [
    ...new Map(suppliers.map((supplier) => [supplier.id, supplier])).values()
  ];
  const [poMappings, vendorMappings] = await Promise.all([
    mapping.getByEntities("purchaseOrder", purchaseOrderIds, RAMP),
    mapping.getByEntities(
      "vendor",
      uniqueSuppliers.map((supplier) => supplier.id),
      RAMP
    )
  ]);
  const batch: RampPurchaseOrderBatch = {
    purchaseOrderIds: new Map(
      [...poMappings].map(([id, row]) => [id, row.externalId])
    ),
    vendorIds: new Map(
      [...vendorMappings].map(([id, row]) => [id, row.externalId])
    ),
    vendorsByExternalId: new Map(),
    vendorsByName: new Map(),
    vendorLookup: { ok: true }
  };
  if (
    uniqueSuppliers.some(
      (supplier) => !batch.vendorIds.has(supplier.id) && supplier.name?.trim()
    )
  ) {
    try {
      for await (const page of client.listVendors()) {
        for (const vendor of page) indexSpendVendor(batch, vendor);
      }
    } catch (error) {
      // Mapped vendors and archive-only orders can still proceed. Only a PO
      // needing this provider lookup inherits the error and holds the cursor.
      batch.vendorLookup = { ok: false, error };
    }
  }
  return batch;
}

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
  companyId?: string,
  batch?: RampPurchaseOrderBatch,
  opts?: {
    /**
     * Rethrow Ramp's rejection instead of returning null.
     *
     * A PO's `vendor_id` is OPTIONAL, so swallowing is right there — the PO
     * still pushes. A BILL requires one, so swallowing turns Ramp's actual
     * complaint ("state is required", "invalid email", …) into a generic
     * "supplier has no Ramp spend vendor" that nobody can act on, with the real
     * cause reaching only a server console.
     */
    surfaceCreateError?: boolean;
  }
): Promise<string | null> {
  const existing = batch
    ? batch.vendorIds.get(supplier.id)
    : await mapping.getExternalId("vendor", supplier.id, RAMP);
  if (existing) return existing;

  const name = (supplier.name ?? "").trim();
  if (!name) return null;
  if (batch && !batch.vendorLookup.ok) throw batch.vendorLookup.error;

  // Prefer an exact identity match on our own external_vendor_id. Fall back to a
  // name match ONLY when it is unambiguous — exactly one Ramp vendor carries
  // this exact (case-insensitive) name — since a shared name is not an identity
  // key and would otherwise link this supplier to the wrong Ramp vendor.
  const byExternal = batch
    ? batch.vendorsByExternalId.get(supplier.id)
    : await findRampSpendVendor(client, { external_vendor_id: supplier.id });
  const matched =
    byExternal ??
    (batch
      ? batch.vendorsByName.get(name.toLowerCase())
      : await findUniqueRampSpendVendorByName(client, name));
  if (matched?.id) {
    await mapping.link("vendor", supplier.id, RAMP, matched.id, {
      createdBy: "system"
    });
    batch?.vendorIds.set(supplier.id, matched.id);
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
    if (opts?.surfaceCreateError) throw createError;
    return null;
  }

  const rampVendorId = created?.id ?? null;
  if (!rampVendorId) return null;

  await mapping.link("vendor", supplier.id, RAMP, rampVendorId, {
    createdBy: "system"
  });
  if (batch) {
    batch.vendorIds.set(supplier.id, rampVendorId);
    indexSpendVendor(batch, {
      id: rampVendorId,
      name,
      external_vendor_id: supplier.id
    });
  }
  return rampVendorId;
}
