import type { KyselyTx } from "@carbon/database/client";
import type { Accounting } from "../../../core/types";
import type { Qbo } from "../models";
import {
  escapeQboQueryValue,
  mapContactToQboContact,
  mapQboContactToLocal,
  QboEntitySyncer,
  type QboWriteOmit,
  toQboNameExistsError,
  updateWithSyncTokenRetry
} from "./shared";

/**
 * QboCustomerSyncer — Carbon customers ↔ QBO Customer objects.
 *
 * QBO keeps customers and vendors as SEPARATE objects (unlike Xero's
 * dual-flag Contact), so none of the Xero ContactSyncer's
 * IsCustomer/IsSupplier dual-mapping applies: this syncer reads and writes
 * the customer tables only, and the mapping rows live under entityType
 * "customer".
 *
 * Push (two-way, owner accounting per DEFAULT_SYNC_CONFIG): name →
 * DisplayName (100-char cap → structured NAME_TOO_LONG Warning; a
 * Duplicate Name Exists fault → structured NAME_EXISTS Warning — QBO's
 * name namespace is shared across customers, vendors and employees).
 * Updates are read-modify-write with the current SyncToken, sent sparse,
 * with ONE refetch-and-retry on a stale token. Pull maps
 * DisplayName/email/phone/BillAddr back onto the customer + its primary
 * contact person.
 */

// Row shape for customer queries with address and contact joins (mirrors
// the Xero ContactSyncer's row so the Contact build stays identical)
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
  postalCode: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  contactMobilePhone: string | null;
  contactHomePhone: string | null;
  contactWorkPhone: string | null;
};

export class QboCustomerSyncer extends QboEntitySyncer<
  Accounting.Contact,
  Qbo.Customer
> {
  // =================================================================
  // 1. ID MAPPING — default implementation (entityType "customer")
  // =================================================================

  // =================================================================
  // 2. LOCAL FETCH (Single + Batch)
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
        "address.postalCode",
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
          country: null,
          region: null,
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
  // 3. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Qbo.Customer | null> {
    const customer = await this.qboProvider.getCustomer(id);
    this.rememberRemoteEntity(customer);
    return customer;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.Customer>> {
    const result = new Map<string, Qbo.Customer>();
    if (ids.length === 0) return result;

    const values = ids.map((id) => `'${escapeQboQueryValue(id)}'`).join(", ");
    const customers = await this.qboProvider.query<Qbo.Customer>(
      "Customer",
      `Id IN (${values})`
    );

    for (const customer of customers) {
      this.rememberRemoteEntity(customer);
      result.set(customer.Id, customer);
    }

    return result;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Contact
  ): Promise<Omit<Qbo.Customer, QboWriteOmit>> {
    return mapContactToQboContact(local, "customer");
  }

  // =================================================================
  // 5. TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Qbo.Customer
  ): Promise<Partial<Accounting.Contact>> {
    return mapQboContactToLocal(remote, { isCustomer: true, isVendor: false });
  }

  // =================================================================
  // 6. UPSERT LOCAL
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    remoteId: string
  ): Promise<string> {
    let existingLocalId = await this.getLocalId(remoteId);

    // Smart match: QBO DisplayNames and Carbon customer names are both
    // unique per company — match by name during backfill to avoid
    // duplicates when no mapping exists yet.
    if (!existingLocalId && data.name) {
      const match = await tx
        .selectFrom("customer")
        .select("id")
        .where("name", "=", data.name)
        .where("companyId", "=", this.companyId)
        .executeTakeFirst();
      existingLocalId = match?.id ?? null;
    }

    const customerId = await this.upsertCustomer(tx, data, existingLocalId);
    await this.upsertContactAndLink(tx, data, customerId);

    return customerId;
  }

  private async upsertCustomer(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    existingId: string | null
  ): Promise<string> {
    if (existingId) {
      await tx
        .updateTable("customer")
        .set({
          name: data.name,
          phone: data.workPhone,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", existingId)
        .execute();
      return existingId;
    }

    const result = await tx
      .insertInto("customer")
      .values({
        companyId: this.companyId,
        name: data.name!,
        phone: data.workPhone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return result.id;
  }

  private async upsertContactAndLink(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    customerId: string
  ): Promise<void> {
    const existingJunction = await tx
      .selectFrom("customerContact")
      .select("contactId")
      .where("customerId", "=", customerId)
      .executeTakeFirst();

    // QBO customers often only carry a DisplayName — fall back to it so the
    // contact person isn't blank (same fallback as the Xero syncer).
    const firstName = data.firstName || data.name || "";
    const lastName = data.lastName ?? "";

    if (existingJunction) {
      await tx
        .updateTable("contact")
        .set({
          email: data.email ?? null,
          firstName,
          lastName,
          workPhone: data.workPhone ?? null
        })
        .where("id", "=", existingJunction.contactId)
        .execute();
      return;
    }

    const contact = await tx
      .insertInto("contact")
      .values({
        companyId: this.companyId,
        email: data.email ?? null,
        firstName,
        lastName,
        workPhone: data.workPhone ?? null,
        isCustomer: true
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await tx
      .insertInto("customerContact")
      .values({
        companyId: this.companyId,
        customerId,
        contactId: contact.id
      })
      .execute();
  }

  // =================================================================
  // 7. UPSERT REMOTE (create, or sparse update with SyncToken retry)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Qbo.Customer, QboWriteOmit>,
    localId: string
  ): Promise<string> {
    let existingRemoteId = await this.getRemoteId(localId);

    // Smart match: QBO DisplayNames are unique — search before creating so
    // backfills against a populated QBO company link instead of colliding.
    if (!existingRemoteId && data.DisplayName) {
      existingRemoteId = await this.findRemoteCustomerByName(data.DisplayName);
    }

    try {
      if (!existingRemoteId) {
        const created = await this.qboProvider.createCustomer(data);
        this.rememberRemoteEntity(created);
        return created.Id;
      }

      const remoteId = existingRemoteId;
      const updated = await updateWithSyncTokenRetry({
        entityLabel: "customer",
        remoteId,
        fetchCurrent: () => this.qboProvider.getCustomer(remoteId),
        update: (syncToken) =>
          this.qboProvider.updateCustomer({
            ...data,
            Id: remoteId,
            SyncToken: syncToken
          })
      });
      this.rememberRemoteEntity(updated);
      return updated.Id;
    } catch (error) {
      const nameExists = toQboNameExistsError(error, {
        entityLabel: "customer",
        name: data.DisplayName
      });
      if (nameExists) throw nameExists;
      throw error;
    }
  }

  private async findRemoteCustomerByName(name: string): Promise<string | null> {
    const matches = await this.qboProvider.query<Qbo.Customer>(
      "Customer",
      `DisplayName = '${escapeQboQueryValue(name)}'`
    );

    const match = matches[0];
    if (!match) return null;

    this.rememberRemoteEntity(match);
    return match.Id;
  }
}
