import type { KyselyTx } from "@carbon/database/client";
import type { Accounting } from "../../../core/types";
import type { Rillet, RilletVendorWrite, RilletWriteOmit } from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  mapContactAddressToRilletAddress,
  mapPaymentTermsToRilletDays,
  RilletEntitySyncer,
  readCarbonExternalReference,
  splitRilletContactName,
  writeDroppingUnregisteredReferences
} from "./shared";

/**
 * RilletVendorSyncer — Carbon suppliers ↔ Rillet Vendor objects.
 *
 * The vendor half of what Xero handles with one dual-flag ContactSyncer:
 * Rillet Vendors are a separate object, so this syncer reads the supplier
 * tables only, with mapping rows under entityType "vendor". Same contract
 * as RilletCustomerSyncer on the push side — no name-matching lookup
 * before create; the carbon external_reference plus the create
 * Idempotency-Key are the duplicate guards there.
 *
 * Automatic sync is push-only (buildRilletSyncConfig forces
 * `push-to-accounting` / `owner: "carbon"`); the PULL half exists for the
 * explicit "Import customers & vendors" action, which enqueues
 * `pull-from-accounting` ledger operations directly. See
 * RilletCustomerSyncer for the full rationale — the two are symmetric.
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

/**
 * Map a Rillet Vendor onto the Carbon contact shape. Pure — exported for
 * tests.
 *
 * `id` carries the Carbon supplier id this Rillet record claims, read off
 * its `carbon` external_reference and qualified by `carbon-company`; it is
 * a MATCH CANDIDATE that `upsertLocal` still verifies. Vendors carry one
 * flat `email` (unlike the customer `emails[]` list) and a `tax_id`, which
 * is the one Rillet field that lands on a real Carbon column
 * (`supplierTax.taxId`).
 */
export function mapRilletVendorToLocal(
  remote: Rillet.Vendor,
  args: { companyId: string }
): Partial<Accounting.Contact> {
  const claimedCarbonId = readCarbonExternalReference(
    remote.external_references,
    args.companyId
  );

  return {
    ...(claimedCarbonId ? { id: claimedCarbonId } : {}),
    name: remote.name,
    companyId: args.companyId,
    ...(remote.email ? { email: remote.email } : {}),
    ...splitRilletContactName(remote.name),
    taxId: remote.tax_id ?? null,
    isCustomer: false,
    isVendor: true
  };
}

export class RilletVendorSyncer extends RilletEntitySyncer<
  Accounting.Contact,
  Rillet.Vendor,
  RilletWriteOmit
> {
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

  /**
   * One cursor-drained `GET /vendors` beats N single GETs for anything past
   * a single id — see RilletCustomerSyncer.fetchRemoteBatch for the full
   * reasoning. Memoized per syncer instance, which the drain builds fresh
   * per batch.
   */
  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Vendor>> {
    const result = new Map<string, Rillet.Vendor>();
    if (ids.length === 0) return result;

    if (ids.length === 1) {
      const vendor = await this.rilletProvider.getVendor(ids[0]!);
      if (vendor) result.set(vendor.id, vendor);
      return result;
    }

    const byId = await this.listRemoteVendorsById();
    for (const id of ids) {
      const vendor = byId.get(id);
      if (vendor) result.set(id, vendor);
    }
    return result;
  }

  private listedVendors: Promise<Map<string, Rillet.Vendor>> | null = null;

  private listRemoteVendorsById(): Promise<Map<string, Rillet.Vendor>> {
    this.listedVendors ??= this.rilletProvider
      .listVendors()
      .then((vendors) => new Map(vendors.map((vendor) => [vendor.id, vendor])));
    return this.listedVendors;
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
  // 4. TRANSFORMATION (Rillet -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Rillet.Vendor
  ): Promise<Partial<Accounting.Contact>> {
    return mapRilletVendorToLocal(remote, { companyId: this.companyId });
  }

  // =================================================================
  // 5. UPSERT LOCAL
  // =================================================================

  /**
   * Resolve the Carbon supplier this Rillet vendor belongs to, then link it.
   * Same match ladder as the customer syncer: mapping row → the Carbon id
   * on the record's own `carbon` external_reference → the name, which
   * `supplier_name_unique (name, companyId)` makes a real key.
   *
   * On a match, Carbon stays the system of record: the ONE field that can be
   * written is a tax id Carbon does not have yet.
   */
  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    remoteId: string
  ): Promise<string> {
    if (!data.name) {
      throw new Error(
        `Rillet vendor ${remoteId} has no name — cannot create a Carbon supplier`
      );
    }

    const existingId =
      (await this.getLocalId(remoteId)) ??
      (await this.findSupplierById(tx, data.id)) ??
      (await this.findSupplierByName(tx, data.name, remoteId));

    const supplierId = existingId ?? (await this.insertSupplier(tx, data));

    await this.fillMissingSupplierTaxId(tx, supplierId, data.taxId ?? null);
    await this.upsertContactAndLink(tx, data, supplierId);

    return supplierId;
  }

  /**
   * The Carbon id claimed by the record's `carbon` external_reference, kept
   * only when a supplier with that id really exists in THIS company — a
   * stale reference must fall through to the name match rather than link a
   * mapping row to a missing id.
   */
  private async findSupplierById(
    tx: KyselyTx,
    claimedId: string | undefined
  ): Promise<string | null> {
    if (!claimedId) return null;

    const match = await tx
      .selectFrom("supplier")
      .select("id")
      .where("id", "=", claimedId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    return match?.id ?? null;
  }

  /**
   * `supplier_name_unique (name, companyId)` makes the name a real key. As
   * with customers, refuse the match when that supplier is already linked to
   * a DIFFERENT Rillet vendor rather than silently re-pointing the mapping.
   */
  private async findSupplierByName(
    tx: KyselyTx,
    name: string,
    remoteId: string
  ): Promise<string | null> {
    const match = await tx
      .selectFrom("supplier")
      .select("id")
      .where("name", "=", name)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (!match) return null;

    const linkedRemoteId = await this.getRemoteId(match.id);
    if (linkedRemoteId && linkedRemoteId !== remoteId) {
      throw new Error(
        `Carbon supplier "${name}" is already linked to Rillet vendor ${linkedRemoteId}; Rillet vendor ${remoteId} has the same name and cannot be linked too`
      );
    }

    return match.id;
  }

  private async insertSupplier(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>
  ): Promise<string> {
    // readableId is filled by the supplier BEFORE INSERT trigger from the
    // company's `supplier` sequence (withTriggersDisabled only sets the
    // app.sync_in_progress flag the EVENT triggers read, so this one runs).
    const inserted = await tx
      .insertInto("supplier")
      .values({
        companyId: this.companyId,
        name: data.name!,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return inserted.id;
  }

  /**
   * Write Rillet's tax id onto the supplier only when Carbon has none.
   * `supplierTax` is a 1:1 side table keyed by supplierId, and a supplier
   * Carbon already knows the tax id for is not Rillet's to correct.
   */
  private async fillMissingSupplierTaxId(
    tx: KyselyTx,
    supplierId: string,
    taxId: string | null
  ): Promise<void> {
    if (!taxId) return;

    await (tx as any)
      .insertInto("supplierTax")
      .values({
        supplierId,
        taxId,
        companyId: this.companyId,
        updatedAt: new Date().toISOString()
      })
      .onConflict((oc: any) =>
        oc
          .column("supplierId")
          .doUpdateSet({ taxId, updatedAt: new Date().toISOString() })
          .where("supplierTax.taxId", "is", null)
      )
      .execute();
  }

  /**
   * A Rillet Vendor has an email but no person, so the contact stands in for
   * the vendor itself — name split off the vendor name, email as given.
   * With NO email there is nothing to record that the supplier row does not
   * already say, so no contact is created.
   */
  private async upsertContactAndLink(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    supplierId: string
  ): Promise<void> {
    if (!data.email) return;

    const existingJunction = await tx
      .selectFrom("supplierContact")
      .select("contactId")
      .where("supplierId", "=", supplierId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (existingJunction) {
      // Only fill a MISSING email: an existing contact is Carbon's.
      await tx
        .updateTable("contact")
        .set({ email: data.email })
        .where("id", "=", existingJunction.contactId)
        .where("companyId", "=", this.companyId)
        .where("email", "is", null)
        .execute();
      return;
    }

    const contact = await tx
      .insertInto("contact")
      .values({
        companyId: this.companyId,
        email: data.email,
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        isCustomer: false
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await tx
      .insertInto("supplierContact")
      .values({
        companyId: this.companyId,
        supplierId,
        contactId: contact.id
      })
      .execute();
  }

  // =================================================================
  // 6. UPSERT REMOTE (create with idempotency key, or PUT update)
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
