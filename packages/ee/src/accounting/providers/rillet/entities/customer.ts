import type { KyselyTx } from "@carbon/database/client";
import { resolveOrCreateRemoteCounterpart } from "../../../core/counterpart";
import type { Accounting } from "../../../core/types";
import type { Rillet, RilletCustomerWrite, RilletWriteOmit } from "../models";
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
 * RilletCustomerSyncer — Carbon customers ↔ Rillet Customer objects.
 *
 * Rillet keeps customers and vendors as separate objects (like QBO, not
 * Xero's dual-flag Contact), so this syncer reads the customer tables
 * only and mapping rows live under entityType "customer". Before creating,
 * the PUSH side resolves an existing remote counterpart through the shared
 * ladder (`core/counterpart.ts`) — mapping row -> carbon external_reference ->
 * email -> name (a Rillet customer carries no tax id), ambiguity creating
 * rather than guessing. The external_reference and the create
 * Idempotency-Key remain the guards against CARBON double-creating; the ladder
 * is what stops it duplicating a customer someone else made.
 *
 * AUTOMATIC sync is push-only: buildRilletSyncConfig forces
 * `push-to-accounting` / `owner: "carbon"`, so no sweep or webhook ever
 * pulls a customer on its own. The PULL half exists for the explicit
 * "Import customers & vendors" action, which enqueues
 * `pull-from-accounting` ledger operations directly
 * (`rillet-import-contacts`). That is also why `owner: "carbon"` matters:
 * `pullBatchFromAccounting` skips an ALREADY-LINKED record, so re-running
 * the import never lets Rillet overwrite a Carbon-owned customer.
 *
 * Linking is the point of the import. Once a mapping row exists,
 * `upsertRemote` below finds it through `getRemoteId` and PUTs the
 * existing Rillet customer — so a sales order raised in Carbon for an
 * imported customer posts against the ORIGINAL Rillet record instead of
 * creating a second one.
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

/**
 * Map a Rillet Customer onto the Carbon contact shape. Pure — exported for
 * tests.
 *
 * `id` carries the Carbon customer id this Rillet record claims, read off
 * its `carbon` external_reference and qualified by `carbon-company`
 * (`readCarbonExternalReference`). It is a MATCH CANDIDATE, not a
 * guarantee — `upsertLocal` still verifies the row exists in this
 * company before linking to it.
 *
 * The MAIN_SENDER address is Rillet's invoice recipient, so it wins over
 * the CC/BCC entries when a customer carries several.
 */
export function mapRilletCustomerToLocal(
  remote: Rillet.Customer,
  args: { companyId: string }
): Partial<Accounting.Contact> {
  const email =
    remote.emails?.find((entry) => entry.type === "MAIN_SENDER")?.email ??
    remote.emails?.[0]?.email;

  const claimedCarbonId = readCarbonExternalReference(
    remote.external_references,
    args.companyId
  );

  return {
    ...(claimedCarbonId ? { id: claimedCarbonId } : {}),
    name: remote.name,
    companyId: args.companyId,
    ...(email ? { email } : {}),
    ...splitRilletContactName(remote.name),
    isCustomer: true,
    isVendor: false
  };
}

export class RilletCustomerSyncer extends RilletEntitySyncer<
  Accounting.Contact,
  Rillet.Customer,
  RilletWriteOmit
> {
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

  /**
   * Rillet has no get-many endpoint, so a batch is either N single GETs or
   * ONE cursor-drained `GET /customers`. The import enqueues a claim-sized
   * batch per drain, and a full list costs
   * ceil(customers / RILLET_PAGE_SIZE) requests no matter how many ids are
   * asked for — so anything past a single id reads the list once and
   * indexes it. A lone id (the single-record path) still takes the cheaper
   * direct GET. The list is memoized per syncer INSTANCE, which the drain
   * builds fresh per batch, so the import never reuses a stale snapshot
   * across batches.
   */
  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Customer>> {
    const result = new Map<string, Rillet.Customer>();
    if (ids.length === 0) return result;

    if (ids.length === 1) {
      const customer = await this.rilletProvider.getCustomer(ids[0]!);
      if (customer) result.set(customer.id, customer);
      return result;
    }

    const byId = await this.listRemoteCustomersById();
    for (const id of ids) {
      const customer = byId.get(id);
      if (customer) result.set(id, customer);
    }
    return result;
  }

  private listedCustomers: Promise<Map<string, Rillet.Customer>> | null = null;

  private listRemoteCustomersById(): Promise<Map<string, Rillet.Customer>> {
    this.listedCustomers ??= this.rilletProvider
      .listCustomers()
      .then(
        (customers) =>
          new Map(customers.map((customer) => [customer.id, customer]))
      );
    return this.listedCustomers;
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
  // 4. TRANSFORMATION (Rillet -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Rillet.Customer
  ): Promise<Partial<Accounting.Contact>> {
    return mapRilletCustomerToLocal(remote, { companyId: this.companyId });
  }

  // =================================================================
  // 5. UPSERT LOCAL
  // =================================================================

  /**
   * Resolve the Carbon customer this Rillet record belongs to, then link it.
   *
   * Match ladder, most to least authoritative:
   *   1. the mapping row (this Rillet id has been linked before),
   *   2. the Carbon id on the record's own `carbon` external_reference —
   *      i.e. Carbon pushed this customer to Rillet in the first place,
   *   3. the name, which `customer_name_unique (name, companyId)` makes a
   *      real key. Without this an import of a previously-pushed customer
   *      would try to INSERT a duplicate name and fail the whole row.
   *
   * On a match, Carbon stays the system of record — the import's job on an
   * existing record is to LINK it, never to let Rillet overwrite it.
   */
  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    remoteId: string
  ): Promise<string> {
    if (!data.name) {
      throw new Error(
        `Rillet customer ${remoteId} has no name — cannot create a Carbon customer`
      );
    }

    const existingId =
      (await this.getLocalId(remoteId)) ??
      (await this.findCustomerById(tx, data.id)) ??
      (await this.findCustomerByName(tx, data.name, remoteId));

    // A matched customer is updated with NOTHING: Rillet's Customer carries
    // no field Carbon keeps on `customer` beyond the name it was matched on
    // (no phone, fax, website, currency or tax id — see
    // Rillet.CustomerSchema). Linking it is the whole job.
    const customerId = existingId ?? (await this.insertCustomer(tx, data));

    await this.upsertContactAndLink(tx, data, customerId);

    return customerId;
  }

  /**
   * The Carbon id claimed by the record's `carbon` external_reference, kept
   * only when a customer with that id really exists in THIS company — a
   * stale reference (the customer was deleted, or the reference came from
   * another Carbon instance) must fall through to the name match rather
   * than link a mapping row to a missing id.
   */
  private async findCustomerById(
    tx: KyselyTx,
    claimedId: string | undefined
  ): Promise<string | null> {
    if (!claimedId) return null;

    const match = await tx
      .selectFrom("customer")
      .select("id")
      .where("id", "=", claimedId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    return match?.id ?? null;
  }

  /**
   * `customer_name_unique (name, companyId)` makes the name a real key, so a
   * name match is a genuine identity claim — and an insert past one would
   * fail on that constraint anyway.
   *
   * Refuse the match when that Carbon customer is already linked to a
   * DIFFERENT Rillet customer. Rillet is not known to enforce unique
   * customer names, and silently re-pointing the mapping would unlink the
   * first Rillet customer without saying so. Failing this one record names
   * both ids in Sync Activity, where the operator can act on it.
   */
  private async findCustomerByName(
    tx: KyselyTx,
    name: string,
    remoteId: string
  ): Promise<string | null> {
    const match = await tx
      .selectFrom("customer")
      .select("id")
      .where("name", "=", name)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (!match) return null;

    const linkedRemoteId = await this.getRemoteId(match.id);
    if (linkedRemoteId && linkedRemoteId !== remoteId) {
      throw new Error(
        `Carbon customer "${name}" is already linked to Rillet customer ${linkedRemoteId}; Rillet customer ${remoteId} has the same name and cannot be linked too`
      );
    }

    return match.id;
  }

  private async insertCustomer(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>
  ): Promise<string> {
    // readableId is filled by the customer BEFORE INSERT trigger from the
    // company's `customer` sequence (withTriggersDisabled only sets the
    // app.sync_in_progress flag the EVENT triggers read, so this one runs).
    const inserted = await tx
      .insertInto("customer")
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
   * A Rillet Customer has emails but no person, so the contact stands in
   * for the company itself: the name is split off the customer name and the
   * MAIN_SENDER email is the one the AR invoices go to. With NO email there
   * is nothing to record that the customer row does not already say, so no
   * contact is created — an empty contact person is noise on a screen, not
   * data.
   *
   * The contact is SECONDARY to the mapping row this whole import exists to
   * write. `contact_email_companyId_unique (email, companyId, isCustomer)`
   * means a second contact with the same email throws, and this runs in the
   * same transaction as `linkEntities` — so a blind insert would roll the
   * mapping back on any email collision (two Rillet customers sharing an
   * address, or an email that already belongs to another Carbon contact).
   * When a same-email contact already exists we therefore skip creating one
   * rather than fail the link; it belongs to another customer (this one has
   * no junction, or the branch above would have caught it), so stealing it
   * would be wrong anyway.
   */
  private async upsertContactAndLink(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    customerId: string
  ): Promise<void> {
    if (!data.email) return;

    // Is this email already held by a DIFFERENT same-class contact? The
    // partial unique index (email, companyId, isCustomer) rejects BOTH the
    // fill-missing UPDATE below (contact.email is nullable) and a fresh
    // INSERT — and this runs in the same transaction as linkEntities, so
    // either rejection rolls back the mapping the import exists to write.
    // Checked up front and honoured in both branches. (concurrency:1 on the
    // job serialises the import, so a pre-check is sufficient here; a
    // concurrent writer racing the same email would need savepoint-scoped
    // conflict handling, which the shared pull transaction does not offer.)
    const emailTaken = await tx
      .selectFrom("contact")
      .select("id")
      .where("email", "=", data.email)
      .where("companyId", "=", this.companyId)
      .where("isCustomer", "=", true)
      .executeTakeFirst();

    const existingJunction = await tx
      .selectFrom("customerContact")
      .select("contactId")
      .where("customerId", "=", customerId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (existingJunction) {
      // Only fill a MISSING email, and only when nothing else owns it.
      if (emailTaken) return;
      await tx
        .updateTable("contact")
        .set({ email: data.email })
        .where("id", "=", existingJunction.contactId)
        .where("companyId", "=", this.companyId)
        .where("email", "is", null)
        .execute();
      return;
    }

    if (emailTaken) return;

    const contact = await tx
      .insertInto("contact")
      .values({
        companyId: this.companyId,
        email: data.email,
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
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
  // 6. UPSERT REMOTE (create with idempotency key, or PUT update)
  // =================================================================

  protected async upsertRemote(
    data: RilletCustomerWrite,
    localId: string
  ): Promise<string> {
    // Mapping first, then the shared ladder — see the vendor syncer. A Rillet
    // customer has no tax id, so it resolves by carbon reference then name.
    const { remoteId: existingRemoteId } =
      await resolveOrCreateRemoteCounterpart({
        provider: this.rilletProvider,
        kind: "customer",
        keys: {
          name: data.name,
          email:
            data.emails?.find((entry) => entry.type === "MAIN_SENDER")?.email ??
            data.emails?.[0]?.email,
          carbonReference: localId
        },
        existingRemoteId: await this.getRemoteId(localId)
      });

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
