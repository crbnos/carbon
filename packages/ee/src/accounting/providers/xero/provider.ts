// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHash } from "node:crypto";
import { getLogger } from "@carbon/logger";
import type {
  CounterpartSearchKeys,
  ExternalIdentityKind,
  RemoteCandidate
} from "../../core/counterpart-types";
import type { RemoteCreateKey } from "../../core/create-key";
import { ProviderID } from "../../core/models";
import type { TaxRateOption } from "../../core/tax-mapping";
import {
  parseXeroTrialBalance,
  type RemoteTrialBalanceRow,
  type XeroTrialBalanceResponse
} from "../../core/trial-balance";
import type {
  AccountingEntityType,
  AuthProvider,
  BaseProvider,
  DimensionTarget,
  GlobalSyncConfig,
  ListChangesResult,
  ProviderCapabilities,
  ProviderChange,
  ProviderConfig,
  ProviderCredentials,
  RemoteUpsertOutcome,
  SupportsIncrementalPull
} from "../../core/types";
import {
  AccountingApiError,
  AccountingAuthError,
  createOAuthClient,
  extractXeroErrorDetails,
  HTTPClient,
  type HttpResponse,
  RatelimitError,
  throwXeroApiError
} from "../../core/utils";
import {
  getXeroBillPaymentSyncEntityId,
  getXeroPaymentSyncEntityId
} from "./entities/payment";
import { parseDotnetDate, type Xero } from "./models";

const logger = getLogger("ee", "accounting", "xero");

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Xero's org-wide limit: at most 2 ACTIVE tracking categories, so at most
 * 2 dimension slots. Exported because the dimension settings read it directly;
 * `XeroProvider.capabilities` now declares the same constant rather than
 * repeating the literal.
 */
export const XERO_MAX_JOURNAL_DIMENSION_SLOTS = 2;

/** Xero returns 100 contacts per page; a short page is the last one. */
const XERO_CONTACTS_PAGE_SIZE = 100;

/**
 * Page cap on the master-data import. 100 pages is 10,000 contacts — past that
 * the import is the wrong tool and the ordinary push sync should carry it.
 */
const XERO_IMPORT_MAX_PAGES = 100;

/** Dimension slot target prefix: `tracking:<TrackingCategoryID>`. */
const XERO_TRACKING_TARGET_PREFIX = "tracking:";

export function buildXeroTrackingTarget(trackingCategoryId: string): string {
  return `${XERO_TRACKING_TARGET_PREFIX}${trackingCategoryId}`;
}

/** The TrackingCategoryID inside a `tracking:<id>` target; null otherwise. */
export function parseXeroTrackingTarget(target: string): string | null {
  if (!target.startsWith(XERO_TRACKING_TARGET_PREFIX)) return null;
  const categoryId = target.slice(XERO_TRACKING_TARGET_PREFIX.length);
  return categoryId.length > 0 ? categoryId : null;
}

// /********************************************************\
// *              Sync-config constraints                   *
// \********************************************************/

/**
 * Entities Xero syncs TWO-WAY: `payment`. Inbound (pull) — Xero payments (both
 * AR ACCREC and AP ACCPAY) settle Carbon invoices/bills (Phase F). Outbound
 * (push) — Carbon-born Posted payments are written to Xero as `/Payments`
 * documents so the settled ACCREC/ACCPAY invoice closes (Phase G). Which
 * direction fires per record is decided by origin: a payment already carrying a
 * `payment` mapping is provider-known and skips push; a mapping-less Carbon
 * payment is pushed. Forced two-way AND enabled — both halves must work as soon
 * as the integration is connected (there is no per-company toggle for it; the
 * documents-mode families gate governs whether it actually runs). Mirrors
 * Rillet's RILLET_TWO_WAY_ENTITIES.
 */
export const XERO_TWO_WAY_ENTITIES = [
  "payment"
] as const satisfies readonly AccountingEntityType[];

/**
 * Master + document entities for which Carbon is the system of record:
 * customers, vendors, items, sales invoices, and bills. Forced
 * `push-to-accounting` / `owner: "carbon"` so Xero is a downstream mirror —
 * Carbon's edits always win, and an inbound Xero change to a linked record is
 * skipped by BaseEntitySyncer's owner guard. This is the standardized "Carbon
 * owns everything" stance that replaced the per-entity Source of Truth setting;
 * it mirrors Rillet's RILLET_PUSH_ONLY_ENTITIES. Their per-company `enabled`
 * flag survives — this constrains ownership, not whether they sync. `payment`
 * is deliberately excluded: the accounting system owns payments (see
 * XERO_TWO_WAY_ENTITIES).
 */
export const XERO_CARBON_OWNED_ENTITIES = [
  "customer",
  "vendor",
  "item",
  "invoice",
  "bill",
  "charge",
  "creditMemo",
  "supplierCredit",
  "reimbursement"
] as const satisfies readonly AccountingEntityType[];

/**
 * Constrain a resolved sync config to Xero's capabilities and Carbon's
 * ownership stance: customers/vendors/items/invoices/bills forced push-only +
 * owner "carbon" (Carbon owns them); `payment` forced two-way + enabled (the
 * accounting system owns it; Carbon-born payments push back out — Phase G).
 * Everything else passes through as resolved.
 */
export function buildXeroSyncConfig(
  resolved: GlobalSyncConfig
): GlobalSyncConfig {
  const entities = Object.fromEntries(
    Object.entries(resolved.entities).map(([entityType, entityConfig]) => [
      entityType,
      { ...entityConfig }
    ])
  ) as GlobalSyncConfig["entities"];

  for (const entityType of XERO_CARBON_OWNED_ENTITIES) {
    entities[entityType] = {
      ...entities[entityType],
      direction: "push-to-accounting",
      owner: "carbon"
    };
  }

  for (const entityType of XERO_TWO_WAY_ENTITIES) {
    entities[entityType] = {
      ...entities[entityType],
      direction: "two-way",
      owner: "accounting",
      enabled: true
    };
  }

  // Always-on: automated postings sync whenever the integration is connected.
  // Forced here (defense-in-depth over the DEFAULT_SYNC_CONFIG default) so a
  // stale stored `enabled: false` override can't silently turn journals off.
  entities.journalEntry = { ...entities.journalEntry, enabled: true };

  return { entities };
}

function getOAuth2Credentials(
  credentials: ProviderCredentials
): Extract<ProviderCredentials, { type: "oauth2" }> {
  if (credentials.type !== "oauth2") {
    throw new Error(
      `Xero requires oauth2 credentials, received "${credentials.type}"`
    );
  }
  return credentials;
}

/**
 * Xero stores its tenant under `providerMetadata.tenantId`. Throws when the
 * tenant is missing — every Xero API call requires the `xero-tenant-id`
 * header, and a descriptive error beats an opaque Xero 401/403.
 */
function getXeroTenantId(
  credentials: ProviderCredentials,
  fallbackTenantId?: string
): string {
  const { providerMetadata } = getOAuth2Credentials(credentials);
  const metadataTenantId = providerMetadata?.tenantId;
  const tenantId =
    typeof metadataTenantId === "string" && metadataTenantId.length > 0
      ? metadataTenantId
      : fallbackTenantId;

  if (!tenantId) {
    throw new Error(
      "Xero credentials are missing tenantId (providerMetadata.tenantId). Reconnect the Xero integration to select an organisation."
    );
  }

  return tenantId;
}

type XeroProviderConfig = ProviderConfig<{
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  tenantId?: string;
}> & {
  id: ProviderID.XERO;
  accessToken?: string;
  refreshToken?: string;
};

export class XeroProvider implements BaseProvider, SupportsIncrementalPull {
  static id = ProviderID.XERO;

  /**
   * Xero declared nothing here until it joined the counterpart ladder, which
   * reads `searchableCounterparts` off this object. Declaring one field means
   * declaring them all honestly: every omitted field now reads as an assertion
   * rather than as "undeclared". `maxJournalDimensionSlots` in particular MUST
   * be present — omitting it from a declared object means "no cap", which is
   * false for Xero.
   *
   * `externalAddressing` is left out deliberately: the resolver's documented
   * default is `account: "code"`, which is exactly Xero's `AccountCode`.
   */
  readonly capabilities: ProviderCapabilities = {
    role: "accounting",
    transport: "rest",
    supportsWebhooks: true,
    supportsJournalPush: true,
    maxJournalDimensionSlots: XERO_MAX_JOURNAL_DIMENSION_SLOTS,
    // One Xero Contact backs both, and ContactSyncer serves both entity types.
    searchableCounterparts: ["customer", "vendor"],
    importableEntities: ["customer", "vendor"]
  };

  /**
   * No cap: `/Payments` with `If-Modified-Since` reaches arbitrarily far back,
   * so the pull-sweep cursor is never clamped.
   */
  readonly pullLookbackDays?: number;

  http: HTTPClient;
  auth: AuthProvider;

  private readonly syncConfig!: GlobalSyncConfig;

  constructor(public config: Omit<XeroProviderConfig, "id">) {
    this.syncConfig = buildXeroSyncConfig(config.syncConfig);
    logger.info("XeroProvider initialized", { companyId: config.companyId });
    this.http = new HTTPClient("https://api.xero.com/api.xro/2.0");
    this.auth = createOAuthClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      redirectUri: config.redirectUri,
      tokenUrl: "https://identity.xero.com/connect/token",
      onTokenRefresh: config.onTokenRefresh,
      beforeRefresh: config.beforeRefresh,
      getAuthUrl(scopes: string[], redirectURL: string): string {
        const params = new URLSearchParams({
          response_type: "code",
          client_id: config.clientId,
          redirect_uri: redirectURL,
          scope: scopes.join(" "),
          state: crypto.randomUUID()
        });

        return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
      }
    });
  }

  get id(): ProviderID.XERO {
    // @ts-expect-error
    return this.constructor.id;
  }

  getSyncConfig(entity: AccountingEntityType) {
    return this.syncConfig.entities[entity];
  }

  authenticate(
    code: string,
    redirectUri: string
  ): Promise<ProviderCredentials> {
    return this.auth.exchangeCode(code, redirectUri);
  }

  /**
   * Candidates for the counterpart ladder (`core/counterpart.ts`).
   *
   * Xero has a real search endpoint, so this queries by name instead of listing
   * the org the way Rillet must. That makes **name the only rung it can
   * answer**: the candidate set is already filtered to one name, so populating
   * an email or tax number on these candidates could never change the outcome.
   * Widening the ladder for Xero means widening this `where`, not adding fields
   * below.
   *
   * Throws on a failed search rather than returning `[]`. The old private
   * `findRemoteContactByName` swallowed the error and returned null, which the
   * caller read as "no such contact" and created a duplicate — a transient 500
   * permanently polluting the customer's contact list. A throw parks the
   * operation and retries instead, matching Rillet and QBO.
   */
  async findRemoteCandidates(
    kind: ExternalIdentityKind,
    keys: CounterpartSearchKeys
  ): Promise<RemoteCandidate[]> {
    if (kind !== "customer" && kind !== "vendor") return [];

    const name = keys.name?.trim();
    if (!name) return [];

    // Xero where filters double-quote string values and escape inner quotes —
    // `JSON.stringify` does both — and the whole clause is then percent-encoded,
    // the same shape `getCreditNoteByNumber` and the reimbursement contact
    // lookup use. Encoding is not cosmetic here: an unencoded `&` in a name like
    // "Smith & Sons" ends the `where` parameter early, so Xero searches for
    // "Smith " and returns the wrong contact (or none), and an unencoded `#`
    // never reaches Xero at all — `fetch` strips the fragment. Either way the
    // caller reads "no such contact" and creates a duplicate.
    const where = encodeURIComponent(`Name==${JSON.stringify(name)}`);
    const result = await this.request<{ Contacts: Xero.Contact[] }>(
      "GET",
      `/Contacts?where=${where}`
    );

    if (result.error) throwXeroApiError("search contacts", result);

    return (result.data?.Contacts ?? []).flatMap((contact) =>
      contact.ContactID
        ? [{ remoteId: contact.ContactID, name: contact.Name ?? null }]
        : []
    );
  }

  async request<T>(
    method: string,
    url: string,
    options?: RequestInit
  ): Promise<HttpResponse<T>> {
    const credentials = this.auth.getCredentials();
    const { accessToken } = getOAuth2Credentials(credentials);
    const tenantId = getXeroTenantId(credentials, this.config.tenantId);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...((options?.headers ?? {}) as Record<string, string>),
      "xero-tenant-id": tenantId
    };

    const response = await this.http.request<T>(method, url, {
      ...options,
      headers: headers
    });

    if (response.code === 401) {
      await this.auth.refresh();

      const { accessToken: refreshedAccessToken } = getOAuth2Credentials(
        this.auth.getCredentials()
      );

      const retryHeaders: Record<string, string> = {
        ...headers,
        Authorization: `Bearer ${refreshedAccessToken}`
      };

      return this.http.request<T>(method, url, {
        ...options,
        headers: retryHeaders
      });
    }

    return response;
  }

  async validate(): Promise<boolean> {
    try {
      const response = await this.request("GET", `/Organisation`);
      return !response.error;
    } catch (error) {
      logger.error("Xero validate error", { error });
      return false;
    }
  }

  /**
   * Fetch the Xero organisation details including base currency.
   */
  async getOrganisation(): Promise<Xero.Organisation | null> {
    const response = await this.request<{ Organisations: Xero.Organisation[] }>(
      "GET",
      "/Organisation"
    );

    if (response.error || !response.data?.Organisations?.[0]) {
      return null;
    }

    return response.data.Organisations[0];
  }

  /**
   * Fetch all currencies enabled/subscribed in the Xero organisation.
   */
  async listCurrencies(): Promise<Xero.Currency[]> {
    const response = await this.request<{ Currencies: Xero.Currency[] }>(
      "GET",
      "/Currencies"
    );

    if (response.error) {
      return [];
    }

    const data = response.data as { Currencies: Xero.Currency[] } | null;
    return data?.Currencies ?? [];
  }

  /**
   * Fetch chart of accounts from Xero.
   * Returns all active accounts by default.
   */
  async listChartOfAccounts(): Promise<Xero.Account[]> {
    const response = await this.request<{ Accounts: Xero.Account[] }>(
      "GET",
      "/Accounts"
    );

    if (response.error) {
      logger.error("Failed to fetch Xero accounts", { response });
      return [];
    }

    // Filter to only active accounts
    return (response.data?.Accounts ?? []).filter(
      (account) => account.Status === "ACTIVE"
    );
  }

  /**
   * Fetch the Xero tracking categories with their options (the journal
   * analytics surface; org-wide limit of 2 active categories). Returns
   * ACTIVE categories only, [] on failure — a settings-surface read, same
   * forgiving contract as listChartOfAccounts.
   */
  async listTrackingCategories(): Promise<Xero.TrackingCategory[]> {
    const response = await this.request<{
      TrackingCategories: Xero.TrackingCategory[];
    }>("GET", "/TrackingCategories");

    if (response.error) {
      logger.error("Failed to fetch Xero tracking categories", { response });
      return [];
    }

    return (response.data?.TrackingCategories ?? []).filter(
      (category) =>
        category.Status === "ACTIVE" || category.Status === undefined
    );
  }

  /**
   * The organisation's ACTIVE tax rates, for the tax-rate mapping tab.
   * [] on failure — a settings-surface read, same forgiving contract as
   * listTrackingCategories.
   */
  async listTaxRates(): Promise<Xero.TaxRate[]> {
    const response = await this.request<{ TaxRates: Xero.TaxRate[] }>(
      "GET",
      "/TaxRates"
    );

    if (response.error) {
      logger.error("Failed to fetch Xero tax rates", { response });
      return [];
    }

    return (response.data?.TaxRates ?? []).filter(
      (rate) => rate.Status === "ACTIVE" || rate.Status === undefined
    );
  }

  /**
   * Create a tracking option under a category by NAME (dimension
   * autoCreate: PUT /TrackingCategories/{id}/Options). Throws an
   * AccountingApiError when Xero rejects it (e.g. option cap reached).
   */
  async createTrackingOption(
    trackingCategoryId: string,
    name: string
  ): Promise<Xero.TrackingOption> {
    const response = await this.request<{
      Options: Xero.TrackingOption[];
    }>("PUT", `/TrackingCategories/${trackingCategoryId}/Options`, {
      body: JSON.stringify({ Name: name })
    });

    if (response.error) {
      throwXeroApiError("create tracking option", response);
    }

    const created = response.data?.Options?.[0];
    if (!created?.TrackingOptionID) {
      throw new Error(
        "Xero API returned success but no TrackingOptionID was returned"
      );
    }

    return created;
  }

  /**
   * The journal dimension targets this org supports: one
   * `tracking:<categoryId>` target per active tracking category (at most
   * XERO_MAX_JOURNAL_DIMENSION_SLOTS org-wide).
   */
  async journalDimensionTargets(): Promise<DimensionTarget[]> {
    const categories = await this.listTrackingCategories();
    return categories.map((category) => ({
      id: buildXeroTrackingTarget(category.TrackingCategoryID),
      label: category.Name,
      capacity: 1
    }));
  }

  /**
   * Create one document (POST /Invoices, /ManualJournals, …) under `key`.
   *
   * Xero replays a create's response for the same `Idempotency-Key` for six
   * minutes only, so the key covers a quick retry of a lost response. A
   * stale reclaim (10 minutes) or a person's Retry comes later: each
   * syncer's durable guard is a lookup by the reference Carbon writes on the
   * document, made before it calls this.
   */
  async createDocument<T>(
    path: string,
    body: unknown,
    key: RemoteCreateKey
  ): Promise<HttpResponse<T>> {
    return this.request<T>("POST", path, {
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": key }
    });
  }

  /**
   * The live invoice or bill a lost create left behind: the one of `type`
   * carrying `invoiceNumber` for `contactId`, or null when no attempt reached
   * Xero. A number another contact's document carries is not this one (Xero
   * numbers its own sales invoices too). Two live matches are a duplicate a
   * person has to resolve.
   */
  async recoverInvoice(args: {
    type: "ACCREC" | "ACCPAY";
    invoiceNumber: string;
    contactId: string;
  }): Promise<{ invoiceId: string; settled: boolean } | null> {
    // Narrowed in Xero to this contact's live documents: a number can repeat
    // across contacts (ACCPAY numbers are the supplier's), and a first page of
    // other contacts' bills would hide this one.
    const clauses = [
      `Type==${JSON.stringify(args.type)}`,
      `InvoiceNumber==${JSON.stringify(args.invoiceNumber)}`,
      ...(GUID.test(args.contactId)
        ? [`Contact.ContactID==guid(${JSON.stringify(args.contactId)})`]
        : []),
      `Status!="DELETED"`,
      `Status!="VOIDED"`
    ];
    const where = encodeURIComponent(clauses.join(" AND "));
    const response = await this.request<{ Invoices: Xero.Invoice[] }>(
      "GET",
      `/Invoices?where=${where}&page=1`
    );
    if (response.error) throwXeroApiError("find invoice by number", response);
    if (!Array.isArray(response.data?.Invoices)) {
      throw new Error("Xero invoice lookup returned no invoice list");
    }

    const live = response.data.Invoices.filter(
      (invoice) =>
        invoice.Type === args.type &&
        invoice.InvoiceNumber === args.invoiceNumber &&
        invoice.Contact?.ContactID === args.contactId &&
        invoice.Status !== "VOIDED" &&
        invoice.Status !== "DELETED" &&
        !!invoice.InvoiceID
    );
    if (live.length > 1) {
      throw new Error(
        `Multiple Xero ${args.type === "ACCPAY" ? "bills" : "invoices"} carry the number ${args.invoiceNumber}; resolve the duplicates before retrying`
      );
    }
    const found = live[0];
    if (!found?.InvoiceID) return null;
    return {
      invoiceId: found.InvoiceID,
      // Xero refuses edits once a payment or credit note is applied.
      settled:
        found.Status === "PAID" ||
        (found.AmountPaid ?? 0) > 0 ||
        (found.AmountCredited ?? 0) > 0
    };
  }

  /**
   * Write a sales invoice (ACCREC) or bill (ACCPAY): an update of
   * `existingRemoteId` when it is mapped, else a create under `key`. When an
   * earlier attempt may have created it (`mayExist`), the create first looks
   * it up by its InvoiceNumber, and a document found there is updated with
   * this payload, since the earlier attempt may have sent an older one,
   * unless Xero has applied a payment or credit note to it: then it is linked
   * as it is. Returns the InvoiceID.
   */
  async upsertInvoiceDocument(args: {
    type: "ACCREC" | "ACCPAY";
    data: Omit<Xero.Invoice, "UpdatedDateUTC">;
    existingRemoteId: string | null;
    mayExist: boolean;
    key: RemoteCreateKey;
  }): Promise<string> {
    const { data } = args;
    const label = args.type === "ACCPAY" ? "bill" : "invoice";
    const recovered =
      !args.existingRemoteId &&
      args.mayExist &&
      data.InvoiceNumber &&
      data.Contact?.ContactID
        ? await this.recoverInvoice({
            type: args.type,
            invoiceNumber: data.InvoiceNumber,
            contactId: data.Contact.ContactID
          })
        : null;
    // A payment or credit note already applied in Xero means the earlier
    // attempt's document stands: Xero refuses an edit, so link it as it is.
    if (recovered?.settled) return recovered.invoiceId;
    const remoteId = args.existingRemoteId ?? recovered?.invoiceId ?? null;

    const result = remoteId
      ? await this.request<{ Invoices: Xero.Invoice[] }>(
          "POST",
          "/Invoices?unitdp=4",
          {
            body: JSON.stringify({
              Invoices: [{ ...data, InvoiceID: remoteId }]
            })
          }
        )
      : await this.createDocument<{ Invoices: Xero.Invoice[] }>(
          "/Invoices?unitdp=4",
          { Invoices: [data] },
          args.key
        );

    if (result.error) {
      throwXeroApiError(`${remoteId ? "update" : "create"} ${label}`, result);
    }

    const invoiceId = result.data?.Invoices?.[0]?.InvoiceID;
    if (!invoiceId) {
      throw new Error(
        `Xero API returned success but no InvoiceID was returned for the ${label}`
      );
    }
    return invoiceId;
  }

  /**
   * Write several invoices (ACCREC) or bills (ACCPAY). The documents that
   * need no lookup (mapped, or never attempted before) go in one request
   * keyed by `batchKey` and the request body, with each document's validation reported on its own
   * (`summarizeErrors=false`). An unmapped one an earlier attempt may have
   * created goes alone through `upsertInvoiceDocument`, which looks it up
   * first. A rate limit or a dead grant stops the writes; the documents not
   * written report it.
   */
  async upsertInvoiceDocuments(args: {
    type: "ACCREC" | "ACCPAY";
    documents: Array<{
      localId: string;
      data: Omit<Xero.Invoice, "UpdatedDateUTC">;
      existingRemoteId: string | null;
      mayExist: boolean;
      key: RemoteCreateKey;
    }>;
    batchKey: RemoteCreateKey;
  }): Promise<Map<string, RemoteUpsertOutcome>> {
    const label = args.type === "ACCPAY" ? "bill" : "invoice";
    const outcomes = new Map<string, RemoteUpsertOutcome>();
    const alone = args.documents.filter(
      (document) => !document.existingRemoteId && document.mayExist
    );
    const together = args.documents.filter(
      (document) => !alone.includes(document)
    );
    let stoppedBy: unknown;
    const stops = (error: unknown) =>
      error instanceof RatelimitError || error instanceof AccountingAuthError;

    if (together.length > 0) {
      try {
        const body = JSON.stringify({
          Invoices: together.map(({ data, existingRemoteId }) =>
            existingRemoteId ? { ...data, InvoiceID: existingRemoteId } : data
          )
        });
        const result = await this.request<{ Invoices: Xero.Invoice[] }>(
          "POST",
          "/Invoices?unitdp=4&summarizeErrors=false",
          {
            body,
            // Xero refuses a key reused on a different request for six
            // minutes, so a fixed or edited re-send of the same documents
            // takes a key of its own. A document an earlier batch may have
            // created never comes back here: it goes alone, after a lookup.
            headers: {
              "Idempotency-Key": createHash("sha256")
                .update(`${args.batchKey}:${body}`)
                .digest("hex")
            }
          }
        );
        if (result.error) throwXeroApiError(`write ${label}s`, result);
        // Xero answers in the order it was sent.
        const returned = result.data?.Invoices ?? [];
        together.forEach(({ localId, existingRemoteId }, i) => {
          const invoice = returned[i] as
            | (Xero.Invoice & {
                HasErrors?: boolean;
                ValidationErrors?: Array<{ Message?: string }>;
              })
            | undefined;
          const operation = `${existingRemoteId ? "update" : "create"} ${label}`;
          if (invoice?.HasErrors || invoice?.ValidationErrors?.length) {
            outcomes.set(localId, {
              error: new AccountingApiError(
                "xero",
                operation,
                extractXeroErrorDetails(400, "Validation failed", {
                  Elements: [invoice]
                })
              )
            });
          } else if (invoice?.InvoiceID) {
            outcomes.set(localId, invoice.InvoiceID);
          } else {
            outcomes.set(localId, {
              error: new Error(
                `Xero API returned success but no InvoiceID was returned for the ${label}`
              )
            });
          }
        });
      } catch (error) {
        for (const { localId } of together) outcomes.set(localId, { error });
        if (stops(error)) stoppedBy = error;
      }
    }

    for (const document of alone) {
      if (stoppedBy !== undefined) {
        outcomes.set(document.localId, { error: stoppedBy });
        continue;
      }
      try {
        outcomes.set(
          document.localId,
          await this.upsertInvoiceDocument({ type: args.type, ...document })
        );
      } catch (error) {
        outcomes.set(document.localId, { error });
        if (stops(error)) stoppedBy = error;
      }
    }
    return outcomes;
  }

  /**
   * The manual journals whose Narration is exactly `narration`
   * (GET /ManualJournals?where=Narration=="…"), the recovery read for a
   * journal create whose response was lost.
   */
  async findManualJournalsByNarration(
    narration: string
  ): Promise<Xero.ManualJournal[]> {
    const where = encodeURIComponent(`Narration==${JSON.stringify(narration)}`);
    const response = await this.request<{
      ManualJournals: Xero.ManualJournal[];
    }>("GET", `/ManualJournals?where=${where}`);

    if (response.error) {
      throwXeroApiError("find manual journal by narration", response);
    }
    if (!Array.isArray(response.data?.ManualJournals)) {
      throw new Error("Xero manual journal lookup returned no journal list");
    }
    return response.data.ManualJournals;
  }

  /**
   * The live manual journal a lost create left behind, found by the
   * Narrations it may carry, or null when no attempt reached Xero. Voided
   * and deleted journals do not count; two live ones are a duplicate a
   * person has to resolve before Carbon pushes again.
   */
  async recoverManualJournal(
    narrations: string[]
  ): Promise<Xero.ManualJournal | null> {
    const live: Xero.ManualJournal[] = [];
    for (const narration of new Set(narrations)) {
      for (const journal of await this.findManualJournalsByNarration(
        narration
      )) {
        if (journal.Status !== "VOIDED" && journal.Status !== "DELETED") {
          live.push(journal);
        }
      }
    }
    if (live.length > 1) {
      throw new Error(
        `Multiple Xero manual journals carry the narration "${narrations[0]}"; resolve the duplicates before retrying`
      );
    }
    return live[0] ?? null;
  }

  /**
   * Create a manual journal (POST /ManualJournals) under `key`. Throws an
   * AccountingApiError when Xero rejects the payload. Pushed journals are
   * immutable, so there is no update.
   */
  async createManualJournal(
    journal: Omit<Xero.ManualJournal, "UpdatedDateUTC" | "ManualJournalID">,
    key: RemoteCreateKey
  ): Promise<Xero.ManualJournal> {
    const response = await this.createDocument<{
      ManualJournals: Xero.ManualJournal[];
    }>("/ManualJournals", { ManualJournals: [journal] }, key);

    if (response.error) {
      throwXeroApiError("create manual journal", response);
    }

    const created = response.data?.ManualJournals?.[0];
    if (!created?.ManualJournalID) {
      throw new Error(
        "Xero API returned success but no ManualJournalID was returned"
      );
    }

    return created;
  }

  /**
   * Whether manual journal `id` is still in the ledger: false when Xero has
   * none (404) or it was deleted or voided. Throws when Xero cannot say, so a
   * caller never takes a failed read for a missing journal.
   */
  async isManualJournalLive(id: string): Promise<boolean> {
    const response = await this.request<{
      ManualJournals: Xero.ManualJournal[];
    }>("GET", `/ManualJournals/${id}`);
    if (response.error) {
      if (response.code === 404) return false;
      throwXeroApiError("read manual journal", response);
    }
    const journal = response.data?.ManualJournals?.[0];
    return (
      !!journal && journal.Status !== "DELETED" && journal.Status !== "VOIDED"
    );
  }

  /**
   * Fetch one manual journal by id (GET /ManualJournals/{id}).
   * Returns null when it does not exist or the request fails.
   */
  async getManualJournal(id: string): Promise<Xero.ManualJournal | null> {
    const response = await this.request<{
      ManualJournals: Xero.ManualJournal[];
    }>("GET", `/ManualJournals/${id}`);

    if (response.error) {
      return null;
    }

    return response.data?.ManualJournals?.[0] ?? null;
  }

  /**
   * The trial balance as at `date` (YYYY-MM-DD), one row per account
   * (GET /Reports/TrialBalance). Needs the `accounting.reports.trialbalance.read`
   * scope; a token minted before Carbon requested it gets a 401/403, thrown
   * as an AccountingApiError carrying that status.
   */
  async getTrialBalance(date: string): Promise<RemoteTrialBalanceRow[]> {
    const response = await this.request<XeroTrialBalanceResponse>(
      "GET",
      `/Reports/TrialBalance?date=${encodeURIComponent(date)}`
    );

    if (response.error || !response.data) {
      throwXeroApiError("read trial balance", response);
    }

    return parseXeroTrialBalance(response.data);
  }

  /**
   * Create a payment (PUT /Payments) applying an amount to a Xero invoice.
   * Xero's single /Payments endpoint settles BOTH families — an ACCREC (sales
   * invoice / AR) and an ACCPAY (bill / AP) invoice — so one method covers the
   * Phase G outbound write-back for both. The `Account.Code` must map to a Xero
   * BANK-type account (the caller pre-checks this against the chart). Throws an
   * AccountingApiError when Xero rejects the payload; returns the created
   * PaymentID.
   */
  async createPayment(
    payment: {
      Invoice: { InvoiceID: string };
      Account: { Code: string };
      Amount: number;
      Date: string;
      Reference: string;
    },
    key: RemoteCreateKey
  ): Promise<string> {
    const response = await this.request<{ Payments: Xero.Payment[] }>(
      "PUT",
      "/Payments",
      {
        body: JSON.stringify({ Payments: [payment] }),
        headers: { "Idempotency-Key": key }
      }
    );

    if (response.error) {
      throwXeroApiError("create payment", response);
    }

    const created = response.data?.Payments?.[0];
    if (!created?.PaymentID) {
      throw new Error(
        "Xero API returned success but no PaymentID was returned"
      );
    }

    return created.PaymentID;
  }

  /**
   * The live payment a lost create left on `invoiceId` under `reference`
   * (GET /Payments?where=Reference=="…"), or null when no attempt reached
   * Xero. Deleted payments do not count; two live ones are a duplicate a
   * person has to resolve.
   */
  async recoverPayment(
    invoiceId: string,
    reference: string
  ): Promise<string | null> {
    const where = encodeURIComponent(`Reference==${JSON.stringify(reference)}`);
    const response = await this.request<{ Payments: Xero.Payment[] }>(
      "GET",
      `/Payments?where=${where}`
    );
    if (response.error)
      throwXeroApiError("find payment by reference", response);
    if (!Array.isArray(response.data?.Payments)) {
      throw new Error("Xero payment lookup returned no payment list");
    }

    const live = response.data.Payments.filter(
      (payment) =>
        payment.Invoice?.InvoiceID === invoiceId &&
        payment.Status !== "DELETED" &&
        !!payment.PaymentID
    );
    if (live.length > 1) {
      throw new Error(
        `Multiple Xero payments carry the reference "${reference}"; resolve the duplicates before retrying`
      );
    }
    return live[0]?.PaymentID ?? null;
  }

  // =================================================================
  // Credit notes (memo external-GL representation)
  // =================================================================

  /**
   * Create a credit note (POST /CreditNotes), ACCRECCREDIT (customer credit,
   * reduces AR) or ACCPAYCREDIT (supplier credit, reduces AP).
   *
   * Created directly as **AUTHORISED**, forced here so no caller can weaken it:
   * Xero will not allocate a DRAFT/SUBMITTED credit note, and it explicitly
   * refuses create-and-allocate in one request — so the note has to land
   * allocatable and the allocation is a second round-trip
   * (`allocateCreditNote`).
   *
   * `Idempotency-Key` is a TRANSIENT-NETWORK guard only: Xero expires the key
   * after six minutes, so it cannot be the job-level dedupe. That remains the
   * `externalIntegrationMapping` row, backed by the deterministic
   * `getCreditNoteByNumber` recovery read for the create-succeeded-but-mapping-
   * failed window.
   *
   * Throws an AccountingApiError when Xero rejects the payload.
   */
  async createCreditNote(
    creditNote: Omit<Xero.CreditNote, "CreditNoteID" | "UpdatedDateUTC">,
    key: RemoteCreateKey
  ): Promise<Xero.CreditNote> {
    const response = await this.createDocument<{
      CreditNotes: Xero.CreditNote[];
    }>(
      "/CreditNotes?unitdp=4",
      // Status last: a credit note MUST be AUTHORISED to be allocatable.
      { CreditNotes: [{ ...creditNote, Status: "AUTHORISED" }] },
      key
    );

    if (response.error) {
      throwXeroApiError("create credit note", response);
    }

    const created = response.data?.CreditNotes?.[0];
    if (!created?.CreditNoteID) {
      throw new Error(
        "Xero API returned success but no CreditNoteID was returned"
      );
    }

    return created;
  }

  /**
   * Find a credit note by its `CreditNoteNumber` (the Carbon memo document
   * number). This is the durable recovery path for the window where the remote
   * create succeeded but the local mapping write did not — Xero's
   * `Idempotency-Key` expires after six minutes and cannot cover it.
   *
   * Returns null when no credit note carries the number. Throws when more than
   * one does (a real duplicate a human has to resolve; silently picking one
   * would allocate against the wrong document).
   */
  async getCreditNoteByNumber(
    creditNoteNumber: string
  ): Promise<Xero.CreditNote | null> {
    const where = encodeURIComponent(
      `CreditNoteNumber==${JSON.stringify(creditNoteNumber)}`
    );
    const response = await this.request<{ CreditNotes: Xero.CreditNote[] }>(
      "GET",
      `/CreditNotes?where=${where}&page=1`
    );

    if (response.error) {
      throwXeroApiError("find credit note by number", response);
    }
    if (!Array.isArray(response.data?.CreditNotes)) {
      throw new Error("Xero credit note lookup returned no credit note list");
    }

    const matches = response.data.CreditNotes;
    if (matches.length > 1) {
      throw new Error(
        `Multiple Xero credit notes carry CreditNoteNumber ${creditNoteNumber}; resolve the duplicates before retrying`
      );
    }

    return matches[0] ?? null;
  }

  /**
   * Allocate a credit note against one invoice
   * (**PUT** /CreditNotes/{id}/Allocations).
   *
   * This is **ADDITIVE, not a reconcile** — Xero appends the allocation to
   * whatever the credit note already carries, so the caller owns
   * idempotency (re-sending double-allocates). Remove one with
   * `deleteCreditNoteAllocation`.
   *
   * `Date` is sent even though the docs describe it as read-only: Xero's own
   * OpenAPI spec marks it required on write.
   */
  async allocateCreditNote(
    creditNoteId: string,
    allocation: {
      Invoice: { InvoiceID: string };
      Amount: number;
      Date: string;
    }
  ): Promise<Xero.CreditNoteAllocation> {
    const response = await this.request<{
      Allocations: Xero.CreditNoteAllocation[];
    }>("PUT", `/CreditNotes/${encodeURIComponent(creditNoteId)}/Allocations`, {
      body: JSON.stringify({ Allocations: [allocation] })
    });

    if (response.error) {
      throwXeroApiError("allocate credit note", response);
    }

    const created = response.data?.Allocations?.[0];
    if (!created) {
      throw new Error(
        "Xero API returned success but no Allocation was returned for the credit note"
      );
    }

    return created;
  }

  /**
   * Remove one allocation from a credit note
   * (DELETE /CreditNotes/{id}/Allocations/{allocationId}) — the counterpart of
   * the additive `allocateCreditNote`.
   */
  async deleteCreditNoteAllocation(
    creditNoteId: string,
    allocationId: string
  ): Promise<void> {
    const response = await this.request(
      "DELETE",
      `/CreditNotes/${encodeURIComponent(
        creditNoteId
      )}/Allocations/${encodeURIComponent(allocationId)}`
    );

    if (response.error) {
      throwXeroApiError("delete credit note allocation", response);
    }
  }

  /**
   * List all contacts from Xero with pagination support.
   * Xero returns 100 contacts per page by default.
   */
  /**
   * Every remote id of a master-data kind, for the one-shot import.
   *
   * Deliberately NOT `listContacts`, whose filter is
   * `IsCustomer==true OR IsSupplier==true`: importing "customers" through that
   * would create Carbon customers out of supplier-only contacts. A Xero contact
   * that is genuinely both appears under both kinds, which is correct — the
   * mapping row is keyed by entity type, so one contact legitimately backs a
   * Carbon customer and a Carbon supplier.
   */
  async listRemoteEntityIds(kind: ExternalIdentityKind): Promise<string[]> {
    const filter =
      kind === "customer"
        ? "IsCustomer==true"
        : kind === "vendor"
          ? "IsSupplier==true"
          : null;
    if (!filter) return [];

    const ids: string[] = [];
    // A short page is the last one — the ONLY evidence the walk saw every
    // contact. Running out of pages instead is not evidence of anything.
    let complete = false;

    for (let page = 1; page <= XERO_IMPORT_MAX_PAGES; page++) {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("where", filter);

      const response = await this.request<{ Contacts: Xero.Contact[] }>(
        "GET",
        `/Contacts?${params.toString()}`
      );

      // Throws rather than stopping short: a partial list read as complete
      // silently imports a subset and reports success.
      if (response.error) throwXeroApiError("list contacts", response);

      const contacts = response.data?.Contacts ?? [];
      for (const contact of contacts) {
        if (contact.ContactID) ids.push(contact.ContactID);
      }

      if (contacts.length < XERO_CONTACTS_PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    // Exhausting the cap is the same failure as a failed page, and it must fail
    // the same way: the caller (`accounting-master-sync`) pulls exactly the ids
    // it is handed and then reports the import succeeded, so returning the first
    // 10,000 would tell the customer every contact came across while the rest
    // silently never arrived. "Carbon could not enumerate them all" is not
    // "these are all of them".
    if (!complete) {
      logger.error("Xero contact enumeration exceeded the import page cap", {
        kind,
        maxPages: XERO_IMPORT_MAX_PAGES,
        collected: ids.length
      });
      throw new Error(
        `Xero has more than ${
          XERO_IMPORT_MAX_PAGES * XERO_CONTACTS_PAGE_SIZE
        } ${kind} contacts; refusing to import a partial list`
      );
    }

    return ids;
  }

  // =================================================================
  // SupportsIncrementalPull — the pull-sweep entry point
  // =================================================================

  /**
   * SupportsIncrementalPull: payments (AR ACCREC + AP ACCPAY) changed since
   * `since`, for the generic accounting-pull-sweep cron. Xero has no payment
   * webhook, so the sweep is the correctness guarantee (the Invoice-update
   * webhook accelerator only shortens latency). Each change carries a
   * `dependsOnMapping` on its settled invoice (entityType "bill" for ACCPAY,
   * "invoice" for ACCREC) — the sweep drops changes whose document has no local
   * mapping (another instance's, or a document created directly in Xero)
   * without ledger noise. Composite ids match the syncer's entity-id contract.
   *
   * No status filter: Xero payments are only ever AUTHORISED or DELETED, and a
   * DELETED payment must reach the syncer so the void path fires — so the poll
   * returns both. A DELETED payment maps to `status: 'void'` in
   * entities/payment.ts.
   *
   * VERIFY: `GET /Payments` with `If-Modified-Since` (whole-second UTC, RFC 1123
   * via toUTCString — the same header the Contacts/Items reads use) is assumed
   * to return AP + AR payments changed since the cursor. Confirm the exact
   * If-Modified-Since format against the Xero sandbox before relying on this in
   * production.
   */
  async listChanges(args: { since: string }): Promise<ListChangesResult> {
    const paymentConfig = this.getSyncConfig("payment");
    if (!paymentConfig.enabled) {
      return { changes: [] };
    }

    // Whole-second UTC — Xero's If-Modified-Since has second resolution.
    const sinceMs = new Date(args.since).getTime();
    const modifiedSince = new Date(
      Number.isNaN(sinceMs) ? Date.now() : Math.floor(sinceMs / 1000) * 1000
    );

    const changes: ProviderChange[] = [];
    let page = 1;

    for (;;) {
      const params = new URLSearchParams();
      params.set("page", String(page));
      // No status filter: Xero payments are only ever AUTHORISED or DELETED,
      // and DELETED (a deletion/void) is exactly what the void path needs — an
      // AUTHORISED-only filter would make the payment/entities void case
      // unreachable (deleted payments are absent from the refetched invoice
      // Payments[] too). Both statuses flow to the syncer, which maps DELETED
      // → status 'void'.

      const response = await this.request<{ Payments: Xero.Payment[] }>(
        "GET",
        `/Payments?${params.toString()}`,
        { headers: { "If-Modified-Since": modifiedSince.toUTCString() } }
      );

      if (response.error || !response.data?.Payments) {
        break;
      }

      const payments = response.data.Payments;
      for (const payment of payments) {
        const invoice = payment.Invoice;
        if (!invoice?.InvoiceID || !invoice.Type) {
          logger.warning(
            "Ignoring Xero payment with no settled invoice id/type",
            { paymentId: payment.PaymentID }
          );
          continue;
        }

        const family = invoice.Type === "ACCPAY" ? "ap" : "ar";
        const remoteId =
          family === "ap"
            ? getXeroBillPaymentSyncEntityId(
                invoice.InvoiceID,
                payment.PaymentID
              )
            : getXeroPaymentSyncEntityId(invoice.InvoiceID, payment.PaymentID);

        changes.push({
          entityType: "payment",
          remoteId,
          updatedAt: payment.UpdatedDateUTC
            ? parseDotnetDate(payment.UpdatedDateUTC).toISOString()
            : null,
          dependsOnMapping: {
            entityType: family === "ap" ? "bill" : "invoice",
            remoteId: invoice.InvoiceID
          }
        });
      }

      // Xero returns 100 payments per page — a full page means there may be more.
      if (payments.length < 100) break;
      page++;
    }

    return { changes };
  }
}

/**
 * The mapping tab's options from Xero's tax rates: a revenue rate is offered
 * for sales, an expense rate for purchases. `EffectiveRate` is in percent
 * points; the option rate is a 0..1 fraction. `ReportTaxType` and the
 * `CanApplyTo*` flags ride along for the legacy-percent tie-break and the
 * account-class check.
 */
export function toXeroTaxRateOptions(
  rates: ReadonlyArray<Xero.TaxRate>
): TaxRateOption[] {
  return rates.flatMap((rate) => {
    const base = {
      id: rate.TaxType,
      name: rate.Name,
      rate: (rate.EffectiveRate ?? rate.DisplayTaxRate ?? 0) / 100,
      reportTaxType: rate.ReportTaxType ?? null,
      canApplyTo: {
        asset: rate.CanApplyToAssets,
        equity: rate.CanApplyToEquity,
        expense: rate.CanApplyToExpenses,
        liability: rate.CanApplyToLiabilities,
        revenue: rate.CanApplyToRevenue
      }
    };
    const options: TaxRateOption[] = [];
    if (rate.CanApplyToRevenue !== false) {
      options.push({ ...base, direction: "sales" });
    }
    if (rate.CanApplyToExpenses !== false) {
      options.push({ ...base, direction: "purchase" });
    }
    return options;
  });
}
