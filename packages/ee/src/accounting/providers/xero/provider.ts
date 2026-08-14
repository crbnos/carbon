import { getLogger } from "@carbon/logger";
import { ProviderID } from "../../core/models";
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
  SupportsIncrementalPull
} from "../../core/types";
import {
  createOAuthClient,
  HTTPClient,
  type HttpResponse,
  throwXeroApiError
} from "../../core/utils";
import {
  getXeroBillPaymentSyncEntityId,
  getXeroPaymentSyncEntityId
} from "./entities/payment";
import { parseDotnetDate, type Xero } from "./models";

const logger = getLogger("ee", "accounting", "xero");

export interface ListContactsOptions {
  page?: number;
  modifiedSince?: Date;
  includeArchived?: boolean;
  summaryOnly?: boolean;
}

export interface ListContactsResponse {
  contacts: Xero.Contact[];
  hasMore: boolean;
  page: number;
}

export interface ListItemsOptions {
  page?: number;
  modifiedSince?: Date;
}

export interface ListItemsResponse {
  items: Xero.Item[];
  hasMore: boolean;
  page: number;
}

/**
 * Xero's org-wide limit: at most 2 ACTIVE tracking categories, so at most
 * 2 dimension slots. Kept as an exported constant (not on `capabilities`)
 * because XeroProvider deliberately leaves `capabilities` undeclared —
 * absent capabilities = legacy REST provider for the drain.
 */
export const XERO_MAX_JOURNAL_DIMENSION_SLOTS = 2;

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
  "bill"
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
   * Undeclared on purpose: absent capabilities = legacy REST provider (the
   * documented default in core/types.ts) — the drain treats Xero exactly
   * as before the field existed.
   */
  readonly capabilities?: ProviderCapabilities;

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
   * Create a manual journal (POST /ManualJournals). Throws an
   * AccountingApiError when Xero rejects the payload. Pass ManualJournalID
   * to update an existing manual journal instead of creating one.
   */
  async createManualJournal(
    journal: Omit<Xero.ManualJournal, "UpdatedDateUTC" | "ManualJournalID"> & {
      ManualJournalID?: string;
    }
  ): Promise<Xero.ManualJournal> {
    const response = await this.request<{
      ManualJournals: Xero.ManualJournal[];
    }>("POST", "/ManualJournals", {
      body: JSON.stringify({ ManualJournals: [journal] })
    });

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
   * Create a payment (PUT /Payments) applying an amount to a Xero invoice.
   * Xero's single /Payments endpoint settles BOTH families — an ACCREC (sales
   * invoice / AR) and an ACCPAY (bill / AP) invoice — so one method covers the
   * Phase G outbound write-back for both. The `Account.Code` must map to a Xero
   * BANK-type account (the caller pre-checks this against the chart). Throws an
   * AccountingApiError when Xero rejects the payload; returns the created
   * PaymentID.
   */
  async createPayment(payment: {
    Invoice: { InvoiceID: string };
    Account: { Code: string };
    Amount: number;
    Date: string;
  }): Promise<string> {
    const response = await this.request<{ Payments: Xero.Payment[] }>(
      "PUT",
      "/Payments",
      { body: JSON.stringify({ Payments: [payment] }) }
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
   * List all contacts from Xero with pagination support.
   * Xero returns 100 contacts per page by default.
   */
  async listContacts(
    options?: ListContactsOptions
  ): Promise<ListContactsResponse> {
    const page = options?.page ?? 1;
    const params = new URLSearchParams();
    params.set("page", String(page));

    if (options?.summaryOnly) {
      params.set("summarizeErrors", "true");
    }

    if (options?.includeArchived) {
      params.set("includeArchived", "true");
    }

    // Only fetch contacts that are customers or suppliers — skip
    // contacts that are neither (e.g. plain address book entries)
    params.set("where", "IsCustomer==true OR IsSupplier==true");

    const headers: Record<string, string> = {};
    if (options?.modifiedSince) {
      headers["If-Modified-Since"] = options.modifiedSince.toUTCString();
    }

    const response = await this.request<{ Contacts: Xero.Contact[] }>(
      "GET",
      `/Contacts?${params.toString()}`,
      { headers }
    );

    if (response.error || !response.data?.Contacts) {
      return { contacts: [], hasMore: false, page };
    }

    const contacts = response.data.Contacts;
    // Xero returns 100 contacts per page - if we get exactly 100, there may be more
    const hasMore = contacts.length === 100;

    return { contacts, hasMore, page };
  }

  /**
   * List all items from Xero with pagination support.
   * Xero returns 100 items per page by default.
   */
  async listItems(options?: ListItemsOptions): Promise<ListItemsResponse> {
    const page = options?.page ?? 1;
    const params = new URLSearchParams();
    params.set("page", String(page));

    const headers: Record<string, string> = {};
    if (options?.modifiedSince) {
      headers["If-Modified-Since"] = options.modifiedSince.toUTCString();
    }

    const response = await this.request<{ Items: Xero.Item[] }>(
      "GET",
      `/Items?${params.toString()}`,
      { headers }
    );

    if (response.error || !response.data?.Items) {
      return { items: [], hasMore: false, page };
    }

    const items = response.data.Items;
    // Xero returns 100 items per page - if we get exactly 100, there may be more
    const hasMore = items.length === 100;

    return { items, hasMore, page };
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
