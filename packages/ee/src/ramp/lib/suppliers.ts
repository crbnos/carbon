import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMappingService } from "../../accounting/core/external-mapping";
import { RAMP } from "./connection";

// /********************************************************\
// *                  Supplier resolution                  *
// \********************************************************/

/**
 * Resolve a Ramp vendor to a Carbon `supplier` id: mapping-first (`vendor`
 * entityType by default), then a case-insensitive exact `supplier.name` match,
 * then auto-create. Links the `externalIntegrationMapping` when a Ramp id is
 * available. The Kysely handle is a PARAM so the calling job passes its own.
 *
 * `opts.entityType` keys the mapping — Ramp bill vendors and card MERCHANTS are
 * different id spaces, so merchants map under `"merchant"` (see
 * {@link resolveMerchantSupplier}). `opts.supplierTypeId` tags an auto-created
 * supplier.
 */
export async function resolveRampSupplier(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  vendor: { id?: string | null; name: string },
  userId: string,
  kyselyDb: Kysely<KyselyDatabase>,
  opts: { entityType?: string; supplierTypeId?: string | null } = {}
): Promise<string> {
  const mapping = createMappingService(kyselyDb, companyId);
  const entityType = opts.entityType ?? "vendor";

  // 1. Mapping-first.
  if (vendor.id) {
    const mapped = await mapping.getEntityId(RAMP, vendor.id, entityType);
    if (mapped) return mapped;
  }

  // 2. Case-insensitive exact name match. `vendor.name` comes from Ramp, so its
  // `%`/`_` must be escaped before `ilike` — otherwise a merchant like
  // "50% Off Supply" becomes a wildcard pattern and matches an unrelated
  // supplier, linking the two permanently.
  const escapedName = vendor.name.replace(/[\\%_]/g, (m) => `\\${m}`);
  const { data: matches } = await serviceRole
    .from("supplier")
    .select("id")
    .eq("companyId", companyId)
    .ilike("name", escapedName)
    .limit(1);
  let supplierId = matches?.[0]?.id ?? null;

  // 3. Auto-create.
  if (!supplierId) {
    const { data: created, error } = await serviceRole
      .from("supplier")
      .insert([
        {
          name: vendor.name,
          companyId,
          createdBy: userId,
          ...(opts.supplierTypeId
            ? { supplierTypeId: opts.supplierTypeId }
            : {})
        }
      ])
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(
        `Failed to create Ramp supplier "${vendor.name}": ${
          error?.message ?? "unknown error"
        }`
      );
    }
    supplierId = created.id;
  }

  if (vendor.id) {
    await mapping.link(entityType, supplierId, RAMP, vendor.id, {
      createdBy: userId
    });
  }

  return supplierId;
}

/** The `supplierType` auto-created suppliers for card merchants are tagged with. */
export const CARD_MERCHANT_SUPPLIER_TYPE = "Card Merchant";

/** The single house supplier all one-off card merchants collapse to. */
export const CARD_MERCHANT_SUPPLIER_NAME = "Card Merchant";

/** Find-or-create a named `supplierType` for the company; returns its id. */
async function ensureSupplierTypeId(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  name: string
): Promise<string> {
  const existing = await serviceRole
    .from("supplierType")
    .select("id")
    .eq("companyId", companyId)
    .eq("name", name)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id;
  const created = await serviceRole
    .from("supplierType")
    .insert([{ name, companyId, createdBy: "system" }])
    .select("id")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `Failed to create the ${name} supplier type: ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  return created.data.id;
}

/**
 * Resolve the MERCHANT of a Ramp card transaction to a Carbon `supplier` id so
 * the charge can carry a vendor to the accounting provider (Rillet `charge`,
 * QBO `Purchase`, Xero SPEND bank transaction all require one). Match-or-default:
 * mapping-first under the `"merchant"` entityType keyed by Ramp's `merchant_id`,
 * then an exact-name match to an EXISTING supplier (a merchant that is already a
 * real vendor), then the single "Card Merchant" house supplier. It NEVER creates
 * a supplier per merchant — that polluted the vendor master with hundreds of
 * one-off rows (see `.ai/specs/2026-09-19-ramp-integration.md`).
 * Merchant identity is preserved on `cardTransaction.merchantName` and pushed
 * onto the provider charge line description.
 */
export async function resolveMerchantSupplier(
  serviceRole: SupabaseClient<Database>,
  kyselyDb: Kysely<KyselyDatabase>,
  companyId: string,
  merchant: { id?: string | null; name: string }
): Promise<string> {
  const mapping = createMappingService(kyselyDb, companyId);
  const supplierTypeId = await ensureSupplierTypeId(
    serviceRole,
    companyId,
    CARD_MERCHANT_SUPPLIER_TYPE
  );

  // 1. Mapping-first — a merchant we've resolved before keeps its supplier.
  if (merchant.id) {
    const mapped = await mapping.getEntityId(RAMP, merchant.id, "merchant");
    if (mapped) return mapped;
  }

  // 2. Exact-name match to an EXISTING supplier. If the merchant is a real
  // vendor you already trade with, link card spend to it. `%`/`_` escaped so a
  // merchant like "50% Off Supply" cannot become a wildcard pattern.
  const escapedName = merchant.name.replace(/[\\%_]/g, (m) => `\\${m}`);
  const { data: matches } = await serviceRole
    .from("supplier")
    .select("id")
    .eq("companyId", companyId)
    .ilike("name", escapedName)
    .limit(1);
  const matchedId = matches?.[0]?.id ?? null;
  if (matchedId) {
    if (merchant.id) {
      await mapping.link("merchant", matchedId, RAMP, merchant.id, {
        createdBy: "system"
      });
    }
    return matchedId;
  }

  // 3. Fall back to the ONE "Card Merchant" house supplier — never a new
  // supplier per merchant. Deliberately NO per-merchant mapping is written, so
  // the mapping table does not re-accumulate one row per merchant; the catch-all
  // is resolved by its stable identity every sync.
  return resolveCardMerchantCatchAllSupplier(
    serviceRole,
    companyId,
    supplierTypeId
  );
}

/**
 * Find-or-create the ONE house "Card Merchant" supplier for the company — the
 * catch-all that carries card spend whose merchant is not (yet) a real vendor.
 * One row per company; the card sync's per-company concurrency (limit 1)
 * serializes creation, so a plain find-then-insert is race-safe.
 */
async function resolveCardMerchantCatchAllSupplier(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  supplierTypeId: string
): Promise<string> {
  const existing = await serviceRole
    .from("supplier")
    .select("id")
    .eq("companyId", companyId)
    .eq("name", CARD_MERCHANT_SUPPLIER_NAME)
    .eq("supplierTypeId", supplierTypeId)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id;

  const created = await serviceRole
    .from("supplier")
    .insert([
      {
        name: CARD_MERCHANT_SUPPLIER_NAME,
        supplierTypeId,
        companyId,
        createdBy: "system"
      }
    ])
    .select("id")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `Failed to create the Card Merchant supplier: ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  return created.data.id;
}

/**
 * Resolve a Ramp USER (the employee a reimbursement/repayment belongs to) to a
 * Carbon `supplier` id. Mapping-first on the `vendor` entityType keyed by the
 * Ramp user id; else ensures an "Employee" `supplierType` exists (created once),
 * auto-creates a supplier named `"<First> <Last> (<email>)"`, links the mapping,
 * and returns the supplier id. Created rows are attributed to `"system"`.
 *
 * The `kyselyDb` handle is a PARAM so the calling job passes its own (the mapping
 * service is Kysely-side). Modeled on {@link resolveRampSupplier}.
 */
export async function resolveEmployeeSupplier(
  serviceRole: SupabaseClient<Database>,
  kyselyDb: Kysely<KyselyDatabase>,
  companyId: string,
  rampUser: {
    user_id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  }
): Promise<string> {
  const mapping = createMappingService(kyselyDb, companyId);

  // 1. Mapping-first — a Ramp user reuses the `vendor` entityType id space.
  const mapped = await mapping.getEntityId(RAMP, rampUser.user_id, "vendor");
  if (mapped) return mapped;

  // 2. Ensure the "Employee" supplier type exists (create once per company).
  const supplierTypeId = await ensureSupplierTypeId(
    serviceRole,
    companyId,
    "Employee"
  );

  // 3. Build a human name: "<First> <Last> (<email>)", degrading gracefully.
  const fullName = [rampUser.first_name, rampUser.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const name = rampUser.email
    ? fullName
      ? `${fullName} (${rampUser.email})`
      : rampUser.email
    : fullName || rampUser.user_id;

  const created = await serviceRole
    .from("supplier")
    .insert([{ name, supplierTypeId, companyId, createdBy: "system" }])
    .select("id")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `Failed to create Ramp employee supplier "${name}": ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  const supplierId = created.data.id;

  await mapping.link("vendor", supplierId, RAMP, rampUser.user_id, {
    createdBy: "system"
  });

  return supplierId;
}
