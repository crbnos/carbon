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

/**
 * Where the Ramp vendor mapping keeps the accounting vendor Carbon last linked
 * that Ramp vendor to. Recorded so a linked supplier resolves from the mapping
 * alone, with no Ramp call, on every push after the first.
 */
const LINKED_ACCOUNTING_VENDOR_KEY = "accountingVendorRemoteId";

/**
 * Everything one push needs to resolve its suppliers' Ramp spend vendors,
 * loaded up front so a page of documents costs a fixed number of reads.
 */
export type RampVendorResolution = {
  /** supplier id → Ramp spend vendor id, from Carbon's `ramp` vendor mappings. */
  vendorIds: Map<string, string>;
  /**
   * supplier id → the accounting vendor Carbon last linked that Ramp vendor to
   * (the mapping's metadata). Compared against `accountingVendorIds` to decide
   * whether a mapped vendor still needs linking.
   */
  linkedAccountingVendorIds: Map<string, string>;
  /**
   * supplier id → the SEAT-HOLDER's vendor id for it (e.g. the Rillet vendor
   * Carbon pushed). Empty when Carbon holds Ramp's accounting seat — Carbon
   * publishes no accounting vendors, so there is nothing to link to.
   */
  accountingVendorIds: Map<string, string>;
  vendorsById: Map<string, RampVendor>;
  vendorsByExternalId: Map<string, RampVendor>;
  vendorsByName: Map<string, RampVendor | null>;
  vendorsByAccountingVendorId: Map<string, RampVendor>;
  vendorLookup: { ok: true } | { ok: false; error: unknown };
};

export type RampPurchaseOrderBatch = RampVendorResolution & {
  purchaseOrderIds: Map<string, string>;
};

function indexSpendVendor(
  resolution: RampVendorResolution,
  vendor: RampVendor
) {
  resolution.vendorsById.set(vendor.id, vendor);
  if (
    typeof vendor.external_vendor_id === "string" &&
    !resolution.vendorsByExternalId.has(vendor.external_vendor_id)
  ) {
    resolution.vendorsByExternalId.set(vendor.external_vendor_id, vendor);
  }
  // Ramp allows an accounting vendor to be linked to ONE Ramp vendor, so this
  // key is unique by construction.
  if (vendor.accounting_vendor_remote_id) {
    resolution.vendorsByAccountingVendorId.set(
      vendor.accounting_vendor_remote_id,
      vendor
    );
  }
  const name = (vendor.name ?? "").trim().toLowerCase();
  if (name)
    resolution.vendorsByName.set(
      name,
      resolution.vendorsByName.has(name) ? null : vendor
    );
}

function linkedAccountingVendorId(
  metadata: Record<string, unknown> | null | undefined
): string | undefined {
  const value = metadata?.[LINKED_ACCOUNTING_VENDOR_KEY];
  return typeof value === "string" && value ? value : undefined;
}

type VendorMappingRow = {
  entityId: string;
  externalId: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * The resolution state from already-loaded rows. Pure —
 * `prepareRampVendorResolution` is this plus the reads.
 */
export function buildRampVendorResolution(args: {
  /** Carbon's `ramp` vendor mappings. */
  vendorMappings: VendorMappingRow[];
  /** The seat-holder's vendor mappings; empty when Carbon holds the seat. */
  accountingVendorMappings?: VendorMappingRow[];
  /** The Ramp vendor snapshot, when one was read. */
  vendors?: RampVendor[];
}): RampVendorResolution {
  const resolution: RampVendorResolution = {
    vendorIds: new Map(
      args.vendorMappings.flatMap((row) =>
        row.externalId ? [[row.entityId, row.externalId] as const] : []
      )
    ),
    linkedAccountingVendorIds: new Map(
      args.vendorMappings.flatMap((row) => {
        const linked = linkedAccountingVendorId(row.metadata);
        return linked ? [[row.entityId, linked] as const] : [];
      })
    ),
    accountingVendorIds: new Map(
      (args.accountingVendorMappings ?? []).flatMap((row) =>
        row.externalId ? [[row.entityId, row.externalId] as const] : []
      )
    ),
    vendorsById: new Map(),
    vendorsByExternalId: new Map(),
    vendorsByName: new Map(),
    vendorsByAccountingVendorId: new Map(),
    vendorLookup: { ok: true }
  };
  for (const vendor of args.vendors ?? []) indexSpendVendor(resolution, vendor);
  return resolution;
}

/**
 * One mapping read per integration and, only when some supplier still needs
 * resolving or linking, one paginated Ramp vendor snapshot.
 *
 * `accountingIntegration` is the integration that holds Ramp's accounting seat
 * when it is not Carbon (`RampProvider.codingIdentityIntegrationId`). Its
 * vendor mappings name the accounting vendor each supplier's Ramp vendor must
 * be linked to.
 */
export async function prepareRampVendorResolution(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  suppliers: RampVendorSupplier[],
  options: { accountingIntegration?: string } = {}
): Promise<RampVendorResolution> {
  const uniqueSuppliers = [
    ...new Map(suppliers.map((supplier) => [supplier.id, supplier])).values()
  ];
  const supplierIds = uniqueSuppliers.map((supplier) => supplier.id);
  const [vendorMappings, accountingVendorMappings] = await Promise.all([
    mapping.getByEntities("vendor", supplierIds, RAMP),
    options.accountingIntegration
      ? mapping.getByEntities(
          "vendor",
          supplierIds,
          options.accountingIntegration
        )
      : Promise.resolve(new Map())
  ]);

  const resolution = buildRampVendorResolution({
    vendorMappings: [...vendorMappings.values()],
    accountingVendorMappings: [...accountingVendorMappings.values()]
  });

  if (uniqueSuppliers.some((supplier) => needsLookup(resolution, supplier))) {
    try {
      for await (const page of client.listVendors()) {
        for (const vendor of page) indexSpendVendor(resolution, vendor);
      }
    } catch (error) {
      // Mapped vendors and archive-only orders can still proceed. Only a
      // supplier needing this provider lookup inherits the error.
      resolution.vendorLookup = { ok: false, error };
    }
  }
  return resolution;
}

/** One mapping read per entity kind and one paginated provider snapshot per PO page. */
export async function prepareRampPurchaseOrderBatch(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  purchaseOrderIds: string[],
  suppliers: RampVendorSupplier[],
  options: { accountingIntegration?: string } = {}
): Promise<RampPurchaseOrderBatch> {
  const [poMappings, resolution] = await Promise.all([
    mapping.getByEntities("purchaseOrder", purchaseOrderIds, RAMP),
    prepareRampVendorResolution(mapping, client, suppliers, options)
  ]);
  return {
    ...resolution,
    purchaseOrderIds: new Map(
      [...poMappings].map(([id, row]) => [id, row.externalId])
    )
  };
}

/** Whether resolving this supplier needs the Ramp vendor snapshot. */
function needsLookup(
  resolution: RampVendorResolution,
  supplier: Pick<RampVendorSupplier, "id" | "name">
): boolean {
  const mapped = resolution.vendorIds.get(supplier.id);
  if (!mapped) return Boolean(supplier.name?.trim());
  const accountingVendorId = resolution.accountingVendorIds.get(supplier.id);
  return (
    accountingVendorId !== undefined &&
    resolution.linkedAccountingVendorIds.get(supplier.id) !== accountingVendorId
  );
}

/**
 * What resolving one supplier's Ramp spend vendor must DO — pure, so the
 * choice is tested with real values and the executor only performs it.
 *
 * - `use` — the mapped vendor, already linked (or nothing to link): no writes.
 * - `match` — record the mapping to `vendorId`; when `linkTo` is set, link the
 *   vendor to that accounting vendor first. `linkedTo` is a link that already
 *   exists in Ramp; `conflict` is one a human made to a DIFFERENT accounting
 *   vendor, which is left alone.
 * - `create` — no vendor to use; create one, then link it when `linkTo` is set.
 * - `none` — nothing to match and no name to create with.
 * - `fail` — the vendor snapshot could not be read and there is no mapping.
 */
export type RampSpendVendorDecision =
  | { action: "use"; vendorId: string }
  | {
      action: "match";
      vendorId: string;
      linkTo?: string;
      linkedTo?: string;
      conflict?: string;
    }
  | { action: "create"; linkTo?: string }
  | { action: "none" }
  | { action: "fail"; error: unknown };

/**
 * The resolution ladder for one supplier:
 *
 * 1. an existing `("vendor", supplier.id, "ramp")` mapping — used as-is unless
 *    it still needs linking to the seat-holder's accounting vendor,
 * 2. the Ramp vendor the seat-holder's accounting vendor is ALREADY linked to
 *    (Ramp allows one, so it is the vendor this supplier's bills belong on —
 *    typically one Ramp created from the accounting provider's own sync),
 * 3. a Ramp vendor already carrying our `external_vendor_id`,
 * 4. a Ramp vendor whose name matches exactly (case-insensitive) and uniquely
 *    — a shared name is not an identity key, so an ambiguous one creates,
 * 5. otherwise create.
 */
export function decideRampSpendVendor(
  resolution: RampVendorResolution,
  supplier: Pick<RampVendorSupplier, "id" | "name">
): RampSpendVendorDecision {
  const mapped = resolution.vendorIds.get(supplier.id);
  const accountingVendorId = resolution.accountingVendorIds.get(supplier.id);
  if (mapped && !needsLookup(resolution, supplier)) {
    return { action: "use", vendorId: mapped };
  }

  const name = (supplier.name ?? "").trim();
  if (!mapped && !name) return { action: "none" };
  if (!resolution.vendorLookup.ok) {
    // A mapped vendor is still a valid `vendor_id`; the link is retried on the
    // next push rather than holding this one on a failed list read.
    return mapped
      ? { action: "use", vendorId: mapped }
      : { action: "fail", error: resolution.vendorLookup.error };
  }

  const alreadyLinked = accountingVendorId
    ? resolution.vendorsByAccountingVendorId.get(accountingVendorId)
    : undefined;
  if (alreadyLinked) {
    return {
      action: "match",
      vendorId: alreadyLinked.id,
      linkedTo: accountingVendorId
    };
  }

  const matched: Pick<RampVendor, "id" | "accounting_vendor_remote_id"> | null =
    mapped
      ? (resolution.vendorsById.get(mapped) ?? { id: mapped })
      : (resolution.vendorsByExternalId.get(supplier.id) ??
        resolution.vendorsByName.get(name.toLowerCase()) ??
        null);
  if (!matched) return { action: "create", linkTo: accountingVendorId };
  if (!accountingVendorId) return { action: "match", vendorId: matched.id };

  const current = matched.accounting_vendor_remote_id;
  if (current === accountingVendorId) {
    return { action: "match", vendorId: matched.id, linkedTo: current };
  }
  if (current) {
    // Someone linked this vendor to a DIFFERENT GL vendor on purpose. Carbon's
    // mapping is weaker evidence than a human's choice, so leave it alone
    // rather than silently re-pointing their bills.
    return { action: "match", vendorId: matched.id, conflict: current };
  }
  return { action: "match", vendorId: matched.id, linkTo: accountingVendorId };
}

/**
 * Link a Ramp SPEND vendor to the seat-holder's ACCOUNTING vendor.
 *
 * Three counterparty objects, three id spaces — Ramp's guide calls confusing
 * them "the most common integration error":
 *
 * - **Merchant** — the card-network counterparty on a transaction. Read-only.
 * - **Vendor** (`/developer/v1/vendors`) — the bill-pay payee. What a PO/bill
 *   `vendor_id` names, and what Carbon creates.
 * - **Accounting vendor** (`/developer/v1/accounting/vendors`) — the GL vendor,
 *   published by whoever holds the accounting connection. Ramp shows it on a
 *   bill as "Accounting Merchant", and it is what the bill posts against.
 *
 * A vendor Carbon creates carries no accounting vendor, so without this link a
 * bill reaches Ramp with "Accounting Merchant" empty and someone has to pick it
 * before the seat-holder can post the bill.
 *
 * Best-effort: the bill still pushes when the link fails, exactly as it did
 * before linking existed, so a refusal here can never block a payable. Returns
 * the accounting vendor the Ramp vendor is now linked to, or undefined when it
 * is not (so the next push tries again).
 */
async function linkAccountingVendor(
  client: RampClient,
  rampVendorId: string,
  accountingVendorId: string
): Promise<string | undefined> {
  try {
    await client.updateSpendVendor(rampVendorId, {
      accounting_vendor_remote_id: accountingVendorId
    });
    return accountingVendorId;
  } catch (error) {
    console.error(
      `[RAMP] failed to link vendor ${rampVendorId} to accounting vendor ${accountingVendorId}`,
      error
    );
    return undefined;
  }
}

async function recordSpendVendor(
  mapping: ExternalIntegrationMappingService,
  resolution: RampVendorResolution,
  supplierId: string,
  rampVendorId: string,
  linkedTo: string | undefined
) {
  await mapping.link("vendor", supplierId, RAMP, rampVendorId, {
    createdBy: "system",
    ...(linkedTo
      ? { metadata: { [LINKED_ACCOUNTING_VENDOR_KEY]: linkedTo } }
      : {})
  });
  resolution.vendorIds.set(supplierId, rampVendorId);
  if (linkedTo) resolution.linkedAccountingVendorIds.set(supplierId, linkedTo);
  else resolution.linkedAccountingVendorIds.delete(supplierId);
}

/**
 * Resolve the Ramp SPEND-vendor id a PO/bill `vendor_id` needs for a Carbon
 * supplier — matching first, creating only as a last resort. The ladder is
 * `decideRampSpendVendor`; this performs what it decides. A create sends the
 * supplier's synced contact email + country (+ address when present) and
 * `external_vendor_id`.
 *
 * Returns `null` (never throws) when the supplier has no name, or has no
 * matching vendor AND lacks the email/country a create requires — the caller
 * decides (a PO omits the optional `vendor_id`; a bill, which requires one, is
 * skipped). Accounting vendors (`/accounting/vendors`) are a DIFFERENT id space
 * a PO/bill `vendor_id` rejects — see `linkAccountingVendor`.
 */
export async function resolveOrCreateRampSpendVendor(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  supplier: RampVendorSupplier,
  companyId: string,
  resolution: RampVendorResolution,
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
  const decision = decideRampSpendVendor(resolution, supplier);
  if (decision.action === "use") return decision.vendorId;
  if (decision.action === "none") return null;
  if (decision.action === "fail") throw decision.error;
  if (decision.action === "match") {
    if (decision.conflict) {
      console.warn(
        `[RAMP] vendor ${decision.vendorId} is linked to accounting vendor ${decision.conflict}, not the one mapped for supplier ${supplier.id}; leaving it`
      );
    }
    const linkedTo = decision.linkTo
      ? await linkAccountingVendor(client, decision.vendorId, decision.linkTo)
      : decision.linkedTo;
    await recordSpendVendor(
      mapping,
      resolution,
      supplier.id,
      decision.vendorId,
      linkedTo
    );
    return decision.vendorId;
  }

  const name = (supplier.name ?? "").trim();
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
  //
  // The accounting-vendor link is deliberately NOT part of the create body: a
  // link Ramp refuses would then fail the create, and with it the bill. It is
  // made by a separate best-effort PATCH below.
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
      // retried push cannot create a duplicate Ramp spend vendor.
      buildRampIdempotencyKey({
        companyId,
        operation: "createSpendVendor",
        scope: supplier.id
      })
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

  const linkedTo = decision.linkTo
    ? await linkAccountingVendor(client, rampVendorId, decision.linkTo)
    : undefined;
  await recordSpendVendor(
    mapping,
    resolution,
    supplier.id,
    rampVendorId,
    linkedTo
  );
  indexSpendVendor(resolution, {
    id: rampVendorId,
    name,
    external_vendor_id: supplier.id,
    accounting_vendor_remote_id: linkedTo
  });
  return rampVendorId;
}
