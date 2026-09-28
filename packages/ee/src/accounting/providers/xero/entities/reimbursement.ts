import { createHash } from "node:crypto";
import type { KyselyTx } from "@carbon/database/client";
import { loadAccountCodesById } from "../../../core/account-mapping";
import { ChargeSyncerBase } from "../../../core/charge-syncer";
import {
  buildDimensionValueMappingEntityId,
  buildDimensionValueMappingLookup,
  ensureDimensionValueExternalIds,
  getDimensionValueMappings,
  resolveDimensionValueLabels,
  upsertDimensionValueMapping
} from "../../../core/dimension-mapping";
import { createMappingService } from "../../../core/external-mapping";
import {
  type PostingSyncSettings,
  resolvePostingSyncSettings
} from "../../../core/posting";
import {
  EMPLOYEE_VENDOR_ENTITY_TYPE,
  employeeVendorName,
  loadReimbursementSources,
  type ReimbursementLineSource,
  type ReimbursementSource,
  resolveReimbursementSyncGate,
  validateReimbursementAccountMapping
} from "../../../core/reimbursement-source";
import type { ShouldSyncContext } from "../../../core/types";
import { throwXeroApiError, withTriggersDisabled } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import { parseXeroTrackingTarget, type XeroProvider } from "../provider";
import { assertXeroMoneyPrecision } from "../serialize";
import type { XeroJournalDimensionArgs } from "./journal-entry";

/**
 * XeroReimbursementSyncer — a Carbon `reimbursement` → a Xero **ACCPAY
 * invoice against an employee Contact** (push-only, create-only; entityType
 * "reimbursement").
 *
 * Xero has no reimbursement object, and — unlike QBO's `Bill.APAccountRef` —
 * **no way to name the AP control account on a document**: Xero's Accounts
 * Payable is a single organisation-level system account. So the segregation
 * the spec is about survives on the CARBON side (`reimbursement` +
 * `employeeReimbursementsPayableAccount`) but NOT in Xero's own ledger, where
 * the reimbursement lands in trade AP alongside supplier bills. That is a real
 * limitation of the provider, recorded here rather than papered over: the
 * mapper deliberately does not require the payable account to be mapped,
 * because demanding a mapping it cannot use would park a document Xero would
 * have accepted.
 *
 * The employee-as-Contact representation lives PROVIDER-SIDE ONLY. No Carbon
 * `supplier` row is created; the link is an `externalIntegrationMapping` row
 * under `employeeVendor` keyed by the Carbon employee id. (Xero's `Employees`
 * endpoint is a payroll object and cannot be an invoice counterparty, so a
 * Contact with `IsSupplier` is the right representation — the same one the
 * `vendor` entity uses.)
 *
 * Create-only: a Posted reimbursement is immutable in Carbon. A Voided one
 * VOIDs the remote invoice and tombstones the mapping (ChargeSyncerBase).
 *
 * VERIFY (Xero sandbox): no sandbox was available when this shipped. The
 * ACCPAY payload follows Xero's Invoices reference (Type, Contact carrying
 * ContactID ONLY — sending other contact fields mutates the contact record —
 * Date, InvoiceNumber, AUTHORISED status, NoTax line amounts, per-line
 * Tracking) but is unverified against a live Xero organisation, like the Xero
 * charge adapter's delete path.
 */

/** The Carbon reimbursement header + lines as the syncer reads them. */
export type XeroReimbursement = ReimbursementSource;

/** Fields Xero assigns; never part of a write payload. */
export type XeroInvoiceWriteOmit = "InvoiceID" | "UpdatedDateUTC";

export type XeroInvoiceWrite = Omit<Xero.Invoice, XeroInvoiceWriteOmit>;

/**
 * Tracking for one line from the company's dimension slots — the charge
 * mapper's resolution, reused. A slotted dimension whose option is unmapped is
 * dropped from the line; the caller has already auto-created opt-in options.
 */
function buildXeroLineTracking(
  line: ReimbursementLineSource,
  dimensions: XeroJournalDimensionArgs | undefined
): Xero.ManualJournalTracking[] {
  const tracking: Xero.ManualJournalTracking[] = [];
  if (!dimensions) return tracking;
  for (const slot of dimensions.slots) {
    const trackingCategoryId = parseXeroTrackingTarget(slot.target);
    if (!trackingCategoryId) continue;
    const dimension = line.dimensions.find(
      (candidate) => candidate.dimensionId === slot.dimensionId
    );
    if (!dimension) continue;
    const trackingOptionId = dimensions.optionIdsByValue.get(
      buildDimensionValueMappingEntityId(
        dimension.dimensionId,
        dimension.valueId
      )
    );
    if (!trackingOptionId) continue; // drop policy — recorded by the caller
    tracking.push({
      TrackingCategoryID: trackingCategoryId,
      TrackingOptionID: trackingOptionId
    });
  }
  return tracking;
}

/**
 * Map a Carbon reimbursement to the Xero ACCPAY invoice write payload. Pure —
 * exported for tests.
 *
 * Line amounts are already in the reimbursement's transaction currency, so
 * the only conversion is Xero's monetary boundary: `assertXeroMoneyPrecision`
 * refuses principal Xero's two decimals cannot represent rather than letting
 * Xero silently round it. `LineAmountTypes: "NoTax"` with `TaxType: "NONE"`
 * lines is the tax-neutral replay the charge and bill adapters use — Carbon's
 * posting already folded any tax into the coded amounts.
 */
export function mapReimbursementToXeroInvoice(args: {
  reimbursement: XeroReimbursement;
  contactId: string;
  accountCodesById: ReadonlyMap<string, string>;
  dimensions?: XeroJournalDimensionArgs;
}): XeroInvoiceWrite {
  const { reimbursement } = args;

  validateReimbursementAccountMapping({
    reimbursement,
    lines: reimbursement.lines,
    payableAccountId: reimbursement.payableAccountId,
    accountsById: args.accountCodesById,
    providerName: "Xero",
    // Xero's AP control account is an organisation-level system account and
    // cannot be named on an invoice — see the class doc.
    requirePayableAccount: false
  });

  assertXeroMoneyPrecision(...reimbursement.lines.map((line) => line.amount));

  const lineItems: Xero.InvoiceLineItem[] = reimbursement.lines.map((line) => {
    const tracking = buildXeroLineTracking(line, args.dimensions);
    return {
      ...(line.description ? { Description: line.description } : {}),
      Quantity: 1,
      UnitAmount: line.amount,
      // Presence asserted by the guard above.
      AccountCode: args.accountCodesById.get(line.accountId)!,
      TaxType: "NONE",
      ...(tracking.length > 0 ? { Tracking: tracking } : {})
    };
  });

  return {
    Type: "ACCPAY",
    // `Reference` is deliberately ABSENT. Xero's Invoices API exposes
    // `Reference` on ACCREC ONLY — on an ACCPAY the value a user sees as
    // "Reference" in the Xero UI is carried by `InvoiceNumber`, and a
    // `Reference` sent on an ACCPAY is silently dropped. So the Carbon
    // readable id travels in `InvoiceNumber`, which is ALSO the deterministic
    // recovery key `upsertRemote` reads back — exactly as the credit-note
    // syncer uses `CreditNoteNumber` (ACCPAYCREDIT has no Reference either).
    // Keying recovery on `Reference` here would have looked correct and
    // recovered nothing.
    InvoiceNumber: reimbursement.reimbursementId,
    Contact: { ContactID: args.contactId },
    // The GL date Carbon booked; posting already shifted it into an open
    // period. Carbon has no due date on a reimbursement, so DueDate is
    // omitted rather than invented — Xero defaults it from the contact's terms.
    Date: reimbursement.postingDate ?? reimbursement.reimbursementDate,
    Status: "AUTHORISED",
    LineAmountTypes: "NoTax",
    CurrencyCode: reimbursement.currencyCode,
    // Pin every foreign snapshot, including negotiated 1:1 rates (the bill
    // convention).
    CurrencyRate:
      reimbursement.currencyCode !== reimbursement.baseCurrencyCode
        ? reimbursement.exchangeRate
        : undefined,
    LineItems: lineItems
  };
}

export class XeroReimbursementSyncer extends ChargeSyncerBase<
  XeroReimbursement,
  Xero.Invoice,
  XeroInvoiceWriteOmit
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private dimensionValueMappingsPromise?: Promise<Map<string, string>>;

  protected get documentLabel(): string {
    return "Reimbursement";
  }

  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  // =================================================================
  // 1. CACHED INPUTS
  // =================================================================

  private getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
  }

  private getPostingSyncSettings(): Promise<PostingSyncSettings> {
    if (!this.postingSyncSettingsPromise) {
      this.postingSyncSettingsPromise = (async () => {
        const integration = await this.database
          .selectFrom("companyIntegration")
          .select("metadata")
          .where("id", "=", this.provider.id)
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return resolvePostingSyncSettings(integration?.metadata);
      })();
    }
    return this.postingSyncSettingsPromise;
  }

  private getDimensionValueMappings(): Promise<Map<string, string>> {
    if (!this.dimensionValueMappingsPromise) {
      this.dimensionValueMappingsPromise = (async () => {
        const mappings = await getDimensionValueMappings(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        if (mappings.error) {
          throw new Error(
            `Failed to load dimension value mappings: ${mappings.error}`
          );
        }
        return buildDimensionValueMappingLookup(mappings.data ?? []);
      })();
    }
    return this.dimensionValueMappingsPromise;
  }

  /** autoCreate (opt-in per slot for Xero) — the charge syncer's flow. */
  private async ensureAutoCreatedDimensionValues(
    lines: ReadonlyArray<ReimbursementLineSource>,
    settings: PostingSyncSettings,
    mappings: Map<string, string>
  ): Promise<void> {
    await ensureDimensionValueExternalIds({
      lines,
      slots: settings.dimensionSlots,
      defaultAutoCreate: false, // Xero: opt-in avoids surprise list writes
      mappings,
      resolveLabels: (values) =>
        resolveDimensionValueLabels(this.database, { values }),
      createExternalValue: async (slot, label) => {
        const trackingCategoryId = parseXeroTrackingTarget(slot.target);
        if (!trackingCategoryId) {
          throw new Error(`Unknown Xero dimension target "${slot.target}"`);
        }
        const created = await this.xeroProvider.createTrackingOption(
          trackingCategoryId,
          label
        );
        return created.TrackingOptionID;
      },
      persistMapping: async (value, externalId, label) => {
        const persisted = await upsertDimensionValueMapping(this.database, {
          companyId: this.companyId,
          integration: this.provider.id,
          dimensionId: value.dimensionId,
          valueId: value.valueId,
          externalId,
          externalName: label
        });
        if (persisted.error) {
          throw new Error(
            `Failed to store dimension value mapping: ${persisted.error}`
          );
        }
      }
    });
  }

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.Invoice): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<XeroReimbursement | null> {
    const reimbursements = await this.fetchReimbursementsByIds([id]);
    return reimbursements.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, XeroReimbursement>> {
    return this.fetchReimbursementsByIds(ids);
  }

  private async fetchReimbursementsByIds(
    ids: string[]
  ): Promise<Map<string, XeroReimbursement>> {
    return loadReimbursementSources(this.database, {
      ids,
      companyId: this.companyId,
      integration: this.provider.id
    });
  }

  // =================================================================
  // 4. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.Invoice | null> {
    const response = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("GET", `/Invoices/${encodeURIComponent(id)}`);
    if (response.error) return null;
    return response.data?.Invoices?.[0] ?? null;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.Invoice>> {
    const result = new Map<string, Xero.Invoice>();
    for (const id of ids) {
      const invoice = await this.fetchRemote(id);
      if (invoice) result.set(invoice.InvoiceID, invoice);
    }
    return result;
  }

  // =================================================================
  // 5. SHOULD SYNC — mirrors POSTING_POLICY.Reimbursement
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<XeroReimbursement, Xero.Invoice>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Reimbursements are push-only; pulling invoices from Xero is not supported";
    }
    if (!context.localEntity) return true;
    return resolveReimbursementSyncGate(context.localEntity);
  }

  // =================================================================
  // 6. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: XeroReimbursement
  ): Promise<XeroInvoiceWrite> {
    const contactId = await this.resolveEmployeeContact(local);

    const settings = await this.getPostingSyncSettings();
    let dimensionValueMappings: Map<string, string> | undefined;
    if (settings.dimensionSlots.length > 0) {
      dimensionValueMappings = await this.getDimensionValueMappings();
      await this.ensureAutoCreatedDimensionValues(
        local.lines,
        settings,
        dimensionValueMappings
      );
    }

    return mapReimbursementToXeroInvoice({
      reimbursement: local,
      contactId,
      accountCodesById: await this.getAccountCodesById(),
      ...(dimensionValueMappings
        ? {
            dimensions: {
              slots: settings.dimensionSlots,
              optionIdsByValue: dimensionValueMappings
            }
          }
        : {})
    });
  }

  /**
   * The Xero Contact the reimbursement is billed to. Mapping-first under
   * `employeeVendor` (NOT `vendor` — that id space holds Carbon supplier ids),
   * else ADOPT the Contact a previous attempt already created, else create it
   * JIT and link it.
   *
   * The mapping is RE-READ here rather than taken from
   * `local.employeeVendorExternalId`: `pushBatchToAccounting` calls
   * `fetchLocalBatch` exactly ONCE, so every snapshot in a batch carries the
   * value as of that single read. Two Posted reimbursements for one employee in
   * one drain therefore both see `null` and both POST the same contact Name.
   * `ensureDependencySynced` re-reads `getRemoteId` per call for exactly this
   * reason.
   *
   * The re-read narrows that window; it does not close the other one. The
   * remote create and the `employeeVendor` mapping write are not one
   * transaction, so a crash (or a failed link) between them leaves a Contact in
   * Xero that Carbon has no row for — and no re-read can find it, because there
   * is no mapping row to read. Xero enforces unique ACTIVE contact names, so a
   * bare retry then fails duplicate-name validation FOREVER, and parking is
   * permanent here: a Posted reimbursement's `updatedAt` never changes, so
   * nothing re-enqueues it.
   *
   * The name lookup below is the durable recovery — the same shape
   * `upsertRemote` uses on `InvoiceNumber`, and the one
   * `ContactSyncer.upsertRemote` already uses for suppliers. It adopts a SINGLE
   * exact-name match and refuses to guess between two, so it never silently
   * takes over someone else's record. The `Idempotency-Key` on the POST only
   * covers the transient-network window (Xero expires it after six minutes),
   * exactly as on the credit note.
   */
  private async resolveEmployeeContact(
    local: XeroReimbursement
  ): Promise<string> {
    const mapped = await this.mappingService.getExternalId(
      EMPLOYEE_VENDOR_ENTITY_TYPE,
      local.employeeId,
      this.provider.id
    );
    if (mapped) return mapped;

    const name = employeeVendorName(local.employee);
    const contactId =
      (await this.findEmployeeContactByName(name)) ??
      (await this.createEmployeeContact(local, name));

    await withTriggersDisabled(this.database, async (tx) => {
      await createMappingService(tx, this.companyId).link(
        EMPLOYEE_VENDOR_ENTITY_TYPE,
        local.employeeId,
        this.provider.id,
        contactId
      );
    });

    return contactId;
  }

  /**
   * The employee's Xero Contact by EXACT name, or null when Xero has none.
   *
   * Two or more contacts answering to the same name throws rather than picking
   * one: billing a reimbursement to the wrong person's contact is not something
   * anything downstream would flag, while a duplicate a human resolves in Xero
   * is recoverable. Same stance as `upsertRemote`'s invoice recovery read and
   * the shared counterpart ladder (`core/counterpart.ts`).
   */
  private async findEmployeeContactByName(
    name: string
  ): Promise<string | null> {
    const result = await this.xeroProvider.request<{
      Contacts: Xero.Contact[];
    }>(
      "GET",
      `/Contacts?where=${encodeURIComponent(
        `Name==${JSON.stringify(name)}`
      )}&page=1`
    );
    if (result.error) throwXeroApiError("find employee contact", result);

    const matches = (result.data?.Contacts ?? []).filter(
      (contact) => contact.Name === name && contact.ContactID
    );
    if (matches.length > 1) {
      throw new Error(
        `Multiple Xero contacts are named "${name}"; resolve the duplicates in Xero before retrying`
      );
    }
    return matches[0]?.ContactID ?? null;
  }

  private async createEmployeeContact(
    local: XeroReimbursement,
    name: string
  ): Promise<string> {
    const result = await this.xeroProvider.request<{
      Contacts: Xero.Contact[];
    }>("POST", "/Contacts", {
      body: JSON.stringify({
        Contacts: [
          {
            Name: name,
            ...(local.employee.firstName
              ? { FirstName: local.employee.firstName }
              : {}),
            ...(local.employee.lastName
              ? { LastName: local.employee.lastName }
              : {}),
            ...(local.employee.email
              ? { EmailAddress: local.employee.email }
              : {}),
            IsSupplier: true
          }
        ]
      }),
      headers: {
        // Transient-network guard only (Xero expires the key after six
        // minutes); the durable recovery is the name lookup above.
        "Idempotency-Key": createHash("sha256")
          .update(`${this.companyId}:employee-vendor:${local.employeeId}`)
          .digest("hex")
      }
    });
    if (result.error) throwXeroApiError("create employee contact", result);
    const contactId = result.data?.Contacts?.[0]?.ContactID;
    if (!contactId) {
      throw new Error(
        `Xero returned no ContactID for employee ${local.employeeId}`
      );
    }
    return contactId;
  }

  // =================================================================
  // 7. TRANSFORMATION (Xero -> Carbon) — not supported (push-only)
  // =================================================================

  protected async mapToLocal(
    _remote: Xero.Invoice
  ): Promise<Partial<XeroReimbursement>> {
    throw new Error(
      "Reimbursements are push-only. Cannot map from Xero to Carbon."
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<XeroReimbursement>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Reimbursements are push-only. Cannot upsert locally from Xero."
    );
  }

  // =================================================================
  // 8. UPSERT REMOTE (create-only)
  // =================================================================

  protected async upsertRemote(
    data: XeroInvoiceWrite,
    localId: string
  ): Promise<string> {
    // Xero's Idempotency-Key expires after six minutes, and the remote create
    // and the local mapping write are not one transaction — so a deterministic
    // read by `InvoiceNumber` (the Carbon readable id) is the durable recovery
    // path, the same contract the credit-note syncer has on
    // `CreditNoteNumber`. It must NOT key on `Reference`: Xero drops that
    // field on ACCPAY.
    const invoiceNumber = data.InvoiceNumber;
    if (!invoiceNumber) {
      throw new Error(
        `Cannot sync reimbursement ${localId}: the invoice carries no InvoiceNumber, so a retry could not recover it`
      );
    }
    const existing = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>(
      "GET",
      `/Invoices?where=${encodeURIComponent(
        `Type=="ACCPAY" AND InvoiceNumber==${JSON.stringify(invoiceNumber)}`
      )}&page=1`
    );
    if (existing.error) throwXeroApiError("recover reimbursement", existing);
    if (!Array.isArray(existing.data?.Invoices)) {
      throw new Error("Xero reimbursement lookup returned no invoice list");
    }
    const matches = existing.data.Invoices;
    if (matches.length > 1) {
      throw new Error(
        "Multiple Xero invoices match this Carbon reimbursement; resolve duplicates before retrying"
      );
    }
    const match = matches[0];
    if (match) {
      if (
        match.InvoiceNumber !== invoiceNumber ||
        match.Type !== "ACCPAY" ||
        match.Status === "VOIDED" ||
        match.Status === "DELETED" ||
        !match.InvoiceID
      ) {
        throw new Error(
          "Xero reimbursement recovery found a voided or inconsistent invoice"
        );
      }
      return match.InvoiceID;
    }

    const result = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("PUT", "/Invoices?unitdp=4", {
      body: JSON.stringify({ Invoices: [data] }),
      headers: {
        "Idempotency-Key": createHash("sha256")
          .update(`${this.companyId}:reimbursement:${localId}`)
          .digest("hex")
      }
    });
    if (result.error) throwXeroApiError("create reimbursement invoice", result);

    const created = result.data?.Invoices?.[0];
    if (!created?.InvoiceID) {
      throw new Error(
        "Xero API returned success but no InvoiceID was returned for the reimbursement"
      );
    }
    return created.InvoiceID;
  }

  protected async upsertRemoteBatch(
    data: Array<{ localId: string; payload: XeroInvoiceWrite }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }

  /**
   * Xero has no DELETE verb for an AUTHORISED invoice: POSTing it with
   * `Status: "VOIDED"` is the void (DELETED applies only to DRAFT/SUBMITTED).
   * Xero refuses to void an invoice that has ANY payment applied against it
   * (its documented restriction), and that refusal surfaces as the
   * operation's failure rather than a silent tombstone — which is correct: a
   * paid reimbursement must be unapplied in Xero by hand before Carbon can
   * claim it was voided.
   *
   * VERIFY (Xero sandbox): unexercised against a live organisation.
   */
  protected async deleteRemote(remoteId: string): Promise<void> {
    const path = `/Invoices/${encodeURIComponent(remoteId)}`;
    const current = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("GET", path);
    if (current.error) {
      throwXeroApiError("read reimbursement invoice before void", current);
    }
    const remote = current.data?.Invoices?.[0];
    if (remote?.InvoiceID !== remoteId) {
      throw new Error(
        "Xero did not return the reimbursement invoice; the void is unconfirmed"
      );
    }
    if (remote.Status === "VOIDED" || remote.Status === "DELETED") return;

    const result = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("POST", path, {
      body: JSON.stringify({
        Invoices: [{ InvoiceID: remoteId, Status: "VOIDED" }]
      })
    });
    if (result.error) throwXeroApiError("void reimbursement invoice", result);
    const voided = result.data?.Invoices?.[0];
    if (voided?.InvoiceID !== remoteId || voided.Status !== "VOIDED") {
      throw new Error(
        "Xero did not confirm the reimbursement invoice was voided"
      );
    }
  }
}
