import type { Accounting } from "../../../core/types";
import type { Rillet, RilletCustomerWrite, RilletWriteOmit } from "../models";
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
 * RilletCustomerSyncer — Carbon customers → Rillet Customer objects.
 * PUSH-ONLY in v1 (buildRilletSyncConfig forces direction/owner): pull
 * methods come from RilletEntitySyncer's push-only rejections.
 *
 * Rillet keeps customers and vendors as separate objects (like QBO, not
 * Xero's dual-flag Contact), so this syncer reads the customer tables
 * only and mapping rows live under entityType "customer". No
 * name-matching lookup before create (unlike QBO's smart match) — the
 * carbon external_reference plus the create Idempotency-Key are the
 * duplicate guards in v1.
 */

// Row shape for customer queries with address and contact joins (mirrors
// the QBO/Xero syncers' row so the Contact build stays identical)
type CustomerRow = {
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
 * Map a Carbon customer to the Rillet Customer write payload. Pure —
 * exported for tests.
 *
 * - The contact email becomes the MAIN_SENDER invoice recipient.
 * - The address maps only when Rillet's all-or-nothing group is complete
 *   (line1/city/state/zip/country).
 * - payment_terms maps only from a bare non-negative integer day count.
 * - external_references carry the carbon (entity id) and
 *   carbon-company (owning Carbon instance) tags.
 */
export function mapContactToRilletCustomer(
  local: Accounting.Contact
): RilletCustomerWrite {
  const address = mapContactAddressToRilletAddress(local);
  const paymentTerms = mapPaymentTermsToRilletDays(local.paymentTerms);

  return {
    name: local.name,
    ...(local.email
      ? { emails: [{ email: local.email, type: "MAIN_SENDER" as const }] }
      : {}),
    ...(address ? { address } : {}),
    ...(paymentTerms !== undefined ? { payment_terms: paymentTerms } : {}),
    external_references: [
      carbonExternalReference(local.id),
      carbonCompanyExternalReference(local.companyId)
    ]
  };
}

export class RilletCustomerSyncer extends RilletEntitySyncer<
  Accounting.Contact,
  Rillet.Customer,
  RilletWriteOmit
> {
  protected get pushOnlyEntityLabel(): string {
    return "Customers";
  }

  // =================================================================
  // 1. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Contact | null> {
    const customers = await this.fetchCustomersByIds([id]);
    return customers.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    return this.fetchCustomersByIds(ids);
  }

  private async fetchCustomersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();

    const rows = await (this.database as any)
      .selectFrom("customer")
      .leftJoin("customerTax", "customerTax.customerId", "customer.id")
      .leftJoin(
        "customerLocation",
        "customerLocation.customerId",
        "customer.id"
      )
      .leftJoin("address", "address.id", "customerLocation.addressId")
      .leftJoin("customerContact", "customerContact.customerId", "customer.id")
      .leftJoin("contact", "contact.id", "customerContact.contactId")
      .select([
        "customer.id",
        "customer.name",
        "customer.companyId",
        "customerTax.taxId as taxId",
        "customer.phone",
        "customer.fax",
        "customer.website",
        "customer.currencyCode",
        "customer.updatedAt",
        "customerLocation.name as locationName",
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
      .where("customer.id", "in", ids)
      .where("customer.companyId", "=", this.companyId)
      .execute();

    return this.groupAndTransformRows(rows as CustomerRow[]);
  }

  private groupAndTransformRows(
    rows: CustomerRow[]
  ): Map<string, Accounting.Contact> {
    const result = new Map<string, Accounting.Contact>();

    const groups = new Map<string, CustomerRow[]>();
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
        isVendor: false,
        isCustomer: true,
        addresses,
        raw: first
      });
    }

    return result;
  }

  // =================================================================
  // 2. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.Customer | null> {
    return this.rilletProvider.getCustomer(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Customer>> {
    const result = new Map<string, Rillet.Customer>();
    for (const id of ids) {
      const customer = await this.rilletProvider.getCustomer(id);
      if (customer) result.set(customer.id, customer);
    }
    return result;
  }

  // =================================================================
  // 3. TRANSFORMATION (Carbon -> Rillet)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Contact
  ): Promise<RilletCustomerWrite> {
    return mapContactToRilletCustomer(local);
  }

  // =================================================================
  // 4. UPSERT REMOTE (create with idempotency key, or PUT update)
  // =================================================================

  protected async upsertRemote(
    data: RilletCustomerWrite,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      const updated = await writeDroppingUnregisteredReferences(
        data,
        (payload) =>
          this.rilletProvider.updateCustomer(existingRemoteId, payload)
      );
      return updated.id ?? existingRemoteId;
    }

    const created = await writeDroppingUnregisteredReferences(data, (payload) =>
      this.rilletProvider.createCustomer(
        payload,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "customer",
          localId
        })
      )
    );
    return created.id;
  }
}
