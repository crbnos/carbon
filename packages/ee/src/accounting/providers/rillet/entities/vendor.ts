import type { Accounting } from "../../../core/types";
import type { Rillet, RilletVendorWrite, RilletWriteOmit } from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  mapContactAddressToRilletAddress,
  mapPaymentTermsToRilletDays,
  RilletEntitySyncer,
  writeDroppingUnregisteredReferences
} from "./shared";

/**
 * RilletVendorSyncer — Carbon suppliers → Rillet Vendor objects.
 * PUSH-ONLY in v1 (buildRilletSyncConfig forces direction/owner): pull
 * methods come from RilletEntitySyncer's push-only rejections.
 *
 * The vendor half of what Xero handles with one dual-flag ContactSyncer:
 * Rillet Vendors are a separate object, so this syncer reads the supplier
 * tables only, with mapping rows under entityType "vendor". Same
 * contract as RilletCustomerSyncer — no name-matching lookup before
 * create; the carbon external_reference plus the create Idempotency-Key
 * are the duplicate guards in v1.
 */

/** Rillet caps vendor payment terms at 180 days. */
export const RILLET_VENDOR_MAX_PAYMENT_TERMS_DAYS = 180;

// Row shape for supplier queries with address and contact joins
type SupplierRow = {
  id: string;
  name: string;
  companyId: string;
  taxId: string | null;
  phone: string | null;
  fax: string | null;
  website: string | null;
  currencyCode: string | null;
  updatedAt: string | null;
  locationName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  countryCode: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  contactMobilePhone: string | null;
  contactHomePhone: string | null;
  contactWorkPhone: string | null;
};

/**
 * Map a Carbon supplier to the Rillet Vendor write payload. Pure —
 * exported for tests.
 *
 * - Vendors carry a single flat `email` (unlike customer `emails[]`).
 * - The address maps only when Rillet's all-or-nothing group is complete.
 * - payment_terms maps only from a bare integer day count within
 *   Rillet's 0-180 vendor range.
 * - tax_id from the Carbon supplier tax id when present.
 * - external_references carry the carbon (entity id) and
 *   carbon-company (owning Carbon instance) tags.
 */
export function mapContactToRilletVendor(
  local: Accounting.Contact
): RilletVendorWrite {
  const address = mapContactAddressToRilletAddress(local);
  const paymentTerms = mapPaymentTermsToRilletDays(local.paymentTerms, {
    max: RILLET_VENDOR_MAX_PAYMENT_TERMS_DAYS
  });

  return {
    name: local.name,
    ...(local.email ? { email: local.email } : {}),
    ...(address ? { address } : {}),
    ...(paymentTerms !== undefined ? { payment_terms: paymentTerms } : {}),
    ...(local.taxId ? { tax_id: local.taxId } : {}),
    external_references: [
      carbonExternalReference(local.id),
      carbonCompanyExternalReference(local.companyId)
    ]
  };
}

export class RilletVendorSyncer extends RilletEntitySyncer<
  Accounting.Contact,
  Rillet.Vendor,
  RilletWriteOmit
> {
  protected get pushOnlyEntityLabel(): string {
    return "Vendors";
  }

  // =================================================================
  // 1. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Contact | null> {
    const suppliers = await this.fetchSuppliersByIds([id]);
    return suppliers.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    return this.fetchSuppliersByIds(ids);
  }

  private async fetchSuppliersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();

    const rows = await (this.database as any)
      .selectFrom("supplier")
      .leftJoin("supplierTax", "supplierTax.supplierId", "supplier.id")
      .leftJoin(
        "supplierLocation",
        "supplierLocation.supplierId",
        "supplier.id"
      )
      .leftJoin("address", "address.id", "supplierLocation.addressId")
      .leftJoin("supplierContact", "supplierContact.supplierId", "supplier.id")
      .leftJoin("contact", "contact.id", "supplierContact.contactId")
      .select([
        "supplier.id",
        "supplier.name",
        "supplier.companyId",
        "supplierTax.taxId as taxId",
        "supplier.phone",
        "supplier.fax",
        "supplier.website",
        "supplier.currencyCode",
        "supplier.updatedAt",
        "supplierLocation.name as locationName",
        "address.addressLine1",
        "address.addressLine2",
        "address.city",
        // stateProvince + countryCode (alpha-2) feed Rillet's
        // all-or-nothing address group (state/country are required there)
        "address.stateProvince",
        "address.postalCode",
        "address.countryCode",
        "contact.firstName as contactFirstName",
        "contact.lastName as contactLastName",
        "contact.email as contactEmail",
        "contact.mobilePhone as contactMobilePhone",
        "contact.homePhone as contactHomePhone",
        "contact.workPhone as contactWorkPhone"
      ])
      .where("supplier.id", "in", ids)
      .where("supplier.companyId", "=", this.companyId)
      .execute();

    return this.groupAndTransformRows(rows as SupplierRow[]);
  }

  private groupAndTransformRows(
    rows: SupplierRow[]
  ): Map<string, Accounting.Contact> {
    const result = new Map<string, Accounting.Contact>();

    const groups = new Map<string, SupplierRow[]>();
    for (const row of rows) {
      const existing = groups.get(row.id) ?? [];
      existing.push(row);
      groups.set(row.id, existing);
    }

    for (const [id, groupRows] of groups) {
      const first = groupRows[0]!;
      const addresses = groupRows
        .filter((r) => r.addressLine1 || r.city)
        .map((r) => ({
          label: r.locationName ?? null,
          type: null,
          line1: r.addressLine1 ?? null,
          line2: r.addressLine2 ?? null,
          city: r.city ?? null,
          country: r.countryCode ?? null,
          region: r.stateProvince ?? null,
          postalCode: r.postalCode ?? null
        }));

      result.set(id, {
        id: first.id,
        name: first.name,
        firstName: first.contactFirstName ?? "",
        lastName: first.contactLastName ?? "",
        companyId: first.companyId,
        email: first.contactEmail ?? undefined,
        website: first.website ?? null,
        taxId: first.taxId ?? null,
        currencyCode: first.currencyCode ?? "USD",
        balance: null,
        creditLimit: null,
        paymentTerms: null,
        updatedAt: first.updatedAt ?? new Date().toISOString(),
        workPhone: first.contactWorkPhone ?? first.phone ?? null,
        mobilePhone: first.contactMobilePhone ?? null,
        fax: first.fax ?? null,
        homePhone: first.contactHomePhone ?? null,
        isVendor: true,
        isCustomer: false,
        addresses,
        raw: first
      });
    }

    return result;
  }

  // =================================================================
  // 2. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.Vendor | null> {
    return this.rilletProvider.getVendor(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Vendor>> {
    const result = new Map<string, Rillet.Vendor>();
    for (const id of ids) {
      const vendor = await this.rilletProvider.getVendor(id);
      if (vendor) result.set(vendor.id, vendor);
    }
    return result;
  }

  // =================================================================
  // 3. TRANSFORMATION (Carbon -> Rillet)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Contact
  ): Promise<RilletVendorWrite> {
    return mapContactToRilletVendor(local);
  }

  // =================================================================
  // 4. UPSERT REMOTE (create with idempotency key, or PUT update)
  // =================================================================

  protected async upsertRemote(
    data: RilletVendorWrite,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      const updated = await writeDroppingUnregisteredReferences(
        data,
        (payload) => this.rilletProvider.updateVendor(existingRemoteId, payload)
      );
      return updated.id ?? existingRemoteId;
    }

    const created = await writeDroppingUnregisteredReferences(data, (payload) =>
      this.rilletProvider.createVendor(
        payload,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "vendor",
          localId
        })
      )
    );
    return created.id;
  }
}
