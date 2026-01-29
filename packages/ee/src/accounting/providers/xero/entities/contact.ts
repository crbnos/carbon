import type { KyselyTx } from "@carbon/database/client";
import { createMappingService } from "../../../core/external-mapping";
import { type Accounting, BaseEntitySyncer } from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";

// Type for rows returned from customer/supplier queries with address joins
type EntityRow = {
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
};

export class ContactSyncer extends BaseEntitySyncer<
  Accounting.Contact,
  Xero.Contact,
  "UpdatedDateUTC"
> {
  // =================================================================
  // 1. ID MAPPING (Override to check both customer and supplier)
  // =================================================================

  async getRemoteId(localId: string): Promise<string | null> {
    // Try customer first
    const customerMapping = await this.mappingService.getExternalId(
      "customer",
      localId,
      this.provider.id
    );

    if (customerMapping) {
      return customerMapping;
    }

    // Try vendor (supplier)
    const vendorMapping = await this.mappingService.getExternalId(
      "vendor",
      localId,
      this.provider.id
    );

    return vendorMapping;
  }

  async getLocalId(remoteId: string): Promise<string | null> {
    // Check customer
    const customerMapping = await this.mappingService.getEntityId(
      this.provider.id,
      remoteId,
      "customer"
    );
    if (customerMapping) return customerMapping;

    // Check vendor (supplier)
    const vendorMapping = await this.mappingService.getEntityId(
      this.provider.id,
      remoteId,
      "vendor"
    );
    return vendorMapping;
  }

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    // Use the syncer's configured entityType so the mapping is consistent
    // with what the base class queries for. The syncer is configured with
    // "customer" or "vendor" — we store that exact value.
    // The unique index includes entityType, so a Xero contact that is both
    // customer and supplier naturally gets two distinct mapping rows.
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      this.entityType,
      localId,
      this.provider.id,
      remoteId,
      { remoteUpdatedAt }
    );
  }

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.Contact): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Contact | null> {
    const customer = await this.fetchCustomersByIds([id]);
    if (customer.has(id)) return customer.get(id)!;

    const supplier = await this.fetchSuppliersByIds([id]);
    return supplier.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();

    const customers = await this.fetchCustomersByIds(ids);
    const remainingIds = ids.filter((id) => !customers.has(id));
    const suppliers = await this.fetchSuppliersByIds(remainingIds);

    return new Map([...customers, ...suppliers]);
  }

  private async fetchCustomersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();

    const rows = await this.database
      .selectFrom("customer")
      .leftJoin(
        "customerLocation",
        "customerLocation.customerId",
        "customer.id"
      )
      .leftJoin("address", "address.id", "customerLocation.addressId")
      .select([
        "customer.id",
        "customer.name",
        "customer.companyId",
        "customer.taxId",
        "customer.phone",
        "customer.fax",
        "customer.website",
        "customer.currencyCode",
        "customer.updatedAt",
        "customerLocation.name as locationName",
        "address.addressLine1",
        "address.addressLine2",
        "address.city",
        "address.postalCode"
      ])
      .where("customer.id", "in", ids)
      .where("customer.companyId", "=", this.companyId)
      .execute();

    return this.groupAndTransformRows(rows, true);
  }

  private async fetchSuppliersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();

    const rows = await this.database
      .selectFrom("supplier")
      .leftJoin(
        "supplierLocation",
        "supplierLocation.supplierId",
        "supplier.id"
      )
      .leftJoin("address", "address.id", "supplierLocation.addressId")
      .select([
        "supplier.id",
        "supplier.name",
        "supplier.companyId",
        "supplier.taxId",
        "supplier.phone",
        "supplier.fax",
        "supplier.website",
        "supplier.currencyCode",
        "supplier.updatedAt",
        "supplierLocation.name as locationName",
        "address.addressLine1",
        "address.addressLine2",
        "address.city",
        "address.postalCode"
      ])
      .where("supplier.id", "in", ids)
      .where("supplier.companyId", "=", this.companyId)
      .execute();

    return this.groupAndTransformRows(rows, false);
  }

  private groupAndTransformRows(
    rows: EntityRow[],
    isCustomer: boolean
  ): Map<string, Accounting.Contact> {
    const result = new Map<string, Accounting.Contact>();

    // Group rows by ID
    const groups = new Map<string, EntityRow[]>();
    for (const row of rows) {
      const existing = groups.get(row.id) ?? [];
      existing.push(row);
      groups.set(row.id, existing);
    }

    for (const [id, groupRows] of groups) {
      const addresses = this.transformAddressRows(groupRows);
      result.set(id, this.buildContact(groupRows[0]!, addresses, isCustomer));
    }

    return result;
  }

  private transformAddressRows(
    rows: EntityRow[]
  ): Accounting.Contact["addresses"] {
    return rows
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
  }

  private buildContact(
    row: EntityRow,
    addresses: Accounting.Contact["addresses"],
    isCustomer: boolean
  ): Accounting.Contact {
    return {
      id: row.id,
      name: row.name,
      firstName: "",
      lastName: "",
      companyId: row.companyId,
      email: undefined,
      website: row.website ?? null,
      taxId: row.taxId ?? null,
      currencyCode: row.currencyCode ?? "USD",
      balance: null,
      creditLimit: null,
      paymentTerms: null,
      updatedAt: row.updatedAt ?? new Date().toISOString(),
      workPhone: row.phone ?? null,
      mobilePhone: null,
      fax: row.fax ?? null,
      homePhone: null,
      isVendor: !isCustomer,
      isCustomer,
      addresses,
      raw: row
    };
  }

  // =================================================================
  // 3. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.Contact | null> {
    const result = await this.provider.request<{ Contacts: Xero.Contact[] }>(
      "GET",
      `/Contacts/${id}`
    );

    return result.error ? null : (result.data?.Contacts?.[0] ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.Contact>> {
    const result = new Map<string, Xero.Contact>();
    if (ids.length === 0) return result;

    const response = await this.provider.request<{ Contacts: Xero.Contact[] }>(
      "GET",
      `/Contacts?IDs=${ids.join(",")}`
    );

    if (response.error) {
      throwXeroApiError("fetch contacts batch", response);
    }

    if (response.data?.Contacts) {
      for (const contact of response.data.Contacts) {
        result.set(contact.ContactID, contact);
      }
    }

    return result;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Contact
  ): Promise<Omit<Xero.Contact, "UpdatedDateUTC">> {
    const existingRemoteId = await this.getRemoteId(local.id);

    const phones: Xero.Contact["Phones"] = [];
    if (local.workPhone)
      phones.push({ PhoneType: "DEFAULT", PhoneNumber: local.workPhone });
    if (local.mobilePhone)
      phones.push({ PhoneType: "MOBILE", PhoneNumber: local.mobilePhone });
    if (local.fax) phones.push({ PhoneType: "FAX", PhoneNumber: local.fax });
    if (local.homePhone)
      phones.push({ PhoneType: "DDI", PhoneNumber: local.homePhone });

    const addresses: Xero.Contact["Addresses"] = local.addresses.map((a) => ({
      AddressType: "STREET" as const,
      AddressLine1: a.line1 ?? undefined,
      AddressLine2: a.line2 ?? undefined,
      City: a.city ?? undefined,
      Region: a.region ?? undefined,
      PostalCode: a.postalCode ?? undefined,
      Country: a.country ?? undefined,
      AttentionTo: a.label ?? undefined
    }));

    return {
      ContactID: existingRemoteId!,
      ContactStatus: "ACTIVE",
      Name: local.name,
      FirstName: local.firstName || undefined,
      LastName: local.lastName || undefined,
      EmailAddress: local.email ?? undefined,
      Website: local.website ?? undefined,
      TaxNumber: local.taxId ?? undefined,
      DefaultCurrency: local.currencyCode,
      IsCustomer: local.isCustomer,
      IsSupplier: local.isVendor,
      Phones: phones,
      Addresses: addresses,
      ContactGroups: [],
      ContactPersons: [],
      HasAttachments: false,
      HasValidationErrors: false
    };
  }

  // =================================================================
  // 5. TRANSFORMATION (Xero -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Xero.Contact
  ): Promise<Partial<Accounting.Contact>> {
    const phones = remote.Phones ?? [];
    const findPhone = (type: string) =>
      phones.find((p) => p.PhoneType === type)?.PhoneNumber ?? null;

    const addresses = (remote.Addresses ?? []).map((a) => ({
      label: a.AttentionTo ?? null,
      type: a.AddressType ?? null,
      line1: a.AddressLine1 ?? null,
      line2: a.AddressLine2 ?? null,
      city: a.City ?? null,
      region: a.Region ?? null,
      country: a.Country ?? null,
      postalCode: a.PostalCode ?? null
    }));

    return {
      name: remote.Name,
      firstName: remote.FirstName ?? "",
      lastName: remote.LastName ?? "",
      email: remote.EmailAddress ?? undefined,
      website: remote.Website ?? null,
      taxId: remote.TaxNumber ?? null,
      currencyCode: remote.DefaultCurrency ?? "USD",
      isCustomer: remote.IsCustomer,
      isVendor: remote.IsSupplier,
      workPhone: findPhone("DEFAULT"),
      mobilePhone: findPhone("MOBILE"),
      fax: findPhone("FAX"),
      homePhone: findPhone("DDI"),
      addresses
    };
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
    const isVendor = data.isVendor && !data.isCustomer ? true : false;

    // Smart match: if no mapping exists, try to find by name (Xero enforces
    // unique contact names, and Carbon enforces unique customer/supplier names
    // per company). This prevents duplicates during backfill.
    if (!existingLocalId && data.name) {
      existingLocalId = await this.findLocalEntityByName(
        tx,
        data.name,
        isVendor
      );
    }

    // 1. Upsert customer/supplier
    const entityId = await this.upsertEntity(
      tx,
      data,
      existingLocalId,
      isVendor
    );

    // 2. Upsert contact and link to customer/supplier
    await this.upsertContactAndLink(tx, data, remoteId, entityId, isVendor);

    return entityId;
  }

  /**
   * Try to find an existing customer/supplier by name within the same company.
   * Used for smart matching during backfill when no ID mapping exists yet.
   */
  private async findLocalEntityByName(
    tx: KyselyTx,
    name: string,
    isVendor: boolean
  ): Promise<string | null> {
    const table = isVendor ? "supplier" : "customer";
    const match = await tx
      .selectFrom(table)
      .select("id")
      .where("name", "=", name)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    return match?.id ?? null;
  }

  private async upsertEntity(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    existingId: string | null,
    isVendor: boolean
  ): Promise<string> {
    const table = isVendor ? "supplier" : "customer";

    if (existingId) {
      await tx
        .updateTable(table)
        .set({
          name: data.name,
          taxId: data.taxId,
          website: data.website,
          phone: data.workPhone,
          fax: data.fax,
          currencyCode: data.currencyCode,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", existingId)
        .execute();
      return existingId;
    }

    const result = await tx
      .insertInto(table)
      .values({
        companyId: this.companyId,
        name: data.name!,
        taxId: data.taxId,
        website: data.website,
        phone: data.workPhone,
        fax: data.fax,
        currencyCode: data.currencyCode,
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
    _remoteId: string,
    entityId: string,
    isVendor: boolean
  ): Promise<void> {
    const junctionTable = isVendor ? "supplierContact" : "customerContact";
    const fkColumn = isVendor ? "supplierId" : "customerId";

    // Find existing contact person via the junction table (not the mapping
    // table). The contact person is a child of the customer/supplier and
    // doesn't need its own external integration mapping.
    const existingJunction = await tx
      .selectFrom(junctionTable)
      .select("contactId")
      .where(fkColumn as any, "=", entityId)
      .executeTakeFirst();

    // Xero contacts often only have a company Name with no FirstName/LastName.
    // Fall back to the entity name so the contact person isn't blank.
    const firstName = data.firstName || data.name || "";
    const lastName = data.lastName ?? "";

    let contactId: string;

    if (existingJunction) {
      // Update existing contact person
      await tx
        .updateTable("contact")
        .set({
          email: data.email ?? null,
          firstName,
          lastName,
          workPhone: data.workPhone ?? null,
          mobilePhone: data.mobilePhone ?? null,
          homePhone: data.homePhone ?? null,
          fax: data.fax ?? null
        })
        .where("id", "=", existingJunction.contactId)
        .execute();
      contactId = existingJunction.contactId;
    } else {
      // Insert new contact person
      const result = await tx
        .insertInto("contact")
        .values({
          companyId: this.companyId,
          email: data.email ?? null,
          firstName,
          lastName,
          workPhone: data.workPhone ?? null,
          mobilePhone: data.mobilePhone ?? null,
          homePhone: data.homePhone ?? null,
          fax: data.fax ?? null,
          isCustomer: !isVendor
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      contactId = result.id;

      // Create the junction link
      await tx
        .insertInto(junctionTable)
        .values({ [fkColumn]: entityId, contactId } as any)
        .execute();
    }
  }

  // =================================================================
  // 7. UPSERT REMOTE (Single + Batch)
  // =================================================================

  protected async upsertRemote(
    data: Xero.Contact,
    localId: string
  ): Promise<string> {
    let existingRemoteId = await this.getRemoteId(localId);

    // Smart match: if no mapping exists, search Xero by name before creating.
    // Xero enforces unique contact names across all active contacts.
    if (!existingRemoteId && data.Name) {
      existingRemoteId = await this.findRemoteContactByName(data.Name);
    }

    const contacts = existingRemoteId
      ? [{ ...data, ContactID: existingRemoteId }]
      : [data];

    const result = await this.provider.request<{ Contacts: Xero.Contact[] }>(
      "POST",
      "/Contacts",
      { body: JSON.stringify({ Contacts: contacts }) }
    );

    if (result.error) {
      throwXeroApiError(
        existingRemoteId ? "update contact" : "create contact",
        result
      );
    }

    if (!result.data?.Contacts?.[0]?.ContactID) {
      throw new Error(
        "Xero API returned success but no ContactID was returned"
      );
    }

    return result.data.Contacts[0].ContactID;
  }

  /**
   * Search Xero for an existing contact by exact name match.
   * Used for smart matching during backfill when no ID mapping exists yet.
   */
  private async findRemoteContactByName(name: string): Promise<string | null> {
    // Xero where filter requires double-quoting string values and escaping quotes
    const escapedName = name.replace(/"/g, '\\"');
    const result = await this.provider.request<{ Contacts: Xero.Contact[] }>(
      "GET",
      `/Contacts?where=Name=="${escapedName}"`
    );

    if (!result.error && result.data?.Contacts?.[0]?.ContactID) {
      return result.data.Contacts[0].ContactID;
    }

    return null;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.Contact, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (data.length === 0) return result;

    const contacts: Xero.Contact[] = [];
    const localIdOrder: string[] = [];

    for (const { localId, payload } of data) {
      const existingRemoteId = await this.getRemoteId(localId);
      contacts.push(
        existingRemoteId
          ? ({ ...payload, ContactID: existingRemoteId } as Xero.Contact)
          : (payload as Xero.Contact)
      );
      localIdOrder.push(localId);
    }

    const response = await this.provider.request<{ Contacts: Xero.Contact[] }>(
      "POST",
      "/Contacts",
      { body: JSON.stringify({ Contacts: contacts }) }
    );

    if (response.error) {
      throwXeroApiError("batch upsert contacts", response);
    }

    if (!response.data?.Contacts) {
      throw new Error(
        "Xero API returned success but no Contacts array was returned"
      );
    }

    for (let i = 0; i < response.data.Contacts.length; i++) {
      const returnedContact = response.data.Contacts[i];
      const localId = localIdOrder[i];
      if (returnedContact?.ContactID && localId) {
        result.set(localId, returnedContact.ContactID);
      }
    }

    return result;
  }
}
