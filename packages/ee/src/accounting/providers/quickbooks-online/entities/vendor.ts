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
 * QboVendorSyncer — Carbon suppliers ↔ QBO Vendor objects.
 *
 * The vendor half of what Xero handles with one dual-flag ContactSyncer:
 * QBO Vendors are a separate object, so this syncer reads and writes the
 * supplier tables only, with mapping rows under entityType "vendor".
 * Same contract as QboCustomerSyncer: DisplayName 100-char cap →
 * NAME_TOO_LONG Warning, Duplicate Name Exists (6240) → NAME_EXISTS
 * Warning (shared name namespace), sparse updates with one
 * stale-SyncToken retry, two-way pull of name/email/phone/address.
 */

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
  postalCode: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  contactMobilePhone: string | null;
  contactHomePhone: string | null;
  contactWorkPhone: string | null;
};

export class QboVendorSyncer extends QboEntitySyncer<
  Accounting.Contact,
  Qbo.Vendor
> {
  // =================================================================
  // 1. ID MAPPING — default implementation (entityType "vendor")
  // =================================================================

  // =================================================================
  // 2. LOCAL FETCH (Single + Batch)
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
        "address.postalCode",
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
        isVendor: true,
        isCustomer: false,
        addresses,
        raw: first
      });
    }

    return result;
  }

  // =================================================================
  // 3. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Qbo.Vendor | null> {
    const vendor = await this.qboProvider.getVendor(id);
    this.rememberRemoteEntity(vendor);
    return vendor;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.Vendor>> {
    const result = new Map<string, Qbo.Vendor>();
    if (ids.length === 0) return result;

    const values = ids.map((id) => `'${escapeQboQueryValue(id)}'`).join(", ");
    const vendors = await this.qboProvider.query<Qbo.Vendor>(
      "Vendor",
      `Id IN (${values})`
    );

    for (const vendor of vendors) {
      this.rememberRemoteEntity(vendor);
      result.set(vendor.Id, vendor);
    }

    return result;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Contact
  ): Promise<Omit<Qbo.Vendor, QboWriteOmit>> {
    return mapContactToQboContact(local, "vendor");
  }

  // =================================================================
  // 5. TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Qbo.Vendor
  ): Promise<Partial<Accounting.Contact>> {
    return mapQboContactToLocal(remote, { isCustomer: false, isVendor: true });
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

    // Smart match by name during backfill (QBO DisplayNames and Carbon
    // supplier names are both unique per company).
    if (!existingLocalId && data.name) {
      const match = await tx
        .selectFrom("supplier")
        .select("id")
        .where("name", "=", data.name)
        .where("companyId", "=", this.companyId)
        .executeTakeFirst();
      existingLocalId = match?.id ?? null;
    }

    const supplierId = await this.upsertSupplier(tx, data, existingLocalId);
    await this.upsertContactAndLink(tx, data, supplierId);

    return supplierId;
  }

  private async upsertSupplier(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    existingId: string | null
  ): Promise<string> {
    if (existingId) {
      await tx
        .updateTable("supplier")
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
      .insertInto("supplier")
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
    supplierId: string
  ): Promise<void> {
    const existingJunction = await tx
      .selectFrom("supplierContact")
      .select("contactId")
      .where("supplierId", "=", supplierId)
      .executeTakeFirst();

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
  // 7. UPSERT REMOTE (create, or sparse update with SyncToken retry)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Qbo.Vendor, QboWriteOmit>,
    localId: string
  ): Promise<string> {
    let existingRemoteId = await this.getRemoteId(localId);

    if (!existingRemoteId && data.DisplayName) {
      existingRemoteId = await this.findRemoteVendorByName(data.DisplayName);
    }

    try {
      if (!existingRemoteId) {
        const created = await this.qboProvider.createVendor(data);
        this.rememberRemoteEntity(created);
        return created.Id;
      }

      const remoteId = existingRemoteId;
      const updated = await updateWithSyncTokenRetry({
        entityLabel: "vendor",
        remoteId,
        fetchCurrent: () => this.qboProvider.getVendor(remoteId),
        update: (syncToken) =>
          this.qboProvider.updateVendor({
            ...data,
            Id: remoteId,
            SyncToken: syncToken
          })
      });
      this.rememberRemoteEntity(updated);
      return updated.Id;
    } catch (error) {
      const nameExists = toQboNameExistsError(error, {
        entityLabel: "vendor",
        name: data.DisplayName
      });
      if (nameExists) throw nameExists;
      throw error;
    }
  }

  private async findRemoteVendorByName(name: string): Promise<string | null> {
    const matches = await this.qboProvider.query<Qbo.Vendor>(
      "Vendor",
      `DisplayName = '${escapeQboQueryValue(name)}'`
    );

    const match = matches[0];
    if (!match) return null;

    this.rememberRemoteEntity(match);
    return match.Id;
  }
}
