import { getLogger } from "@carbon/logger";
import { ProviderID } from "../../core/models";
import type {
  AccountingEntityType,
  AuthProvider,
  BaseProvider,
  DimensionTarget,
  GlobalSyncConfig,
  ProviderCapabilities,
  ProviderConfig,
  ProviderCredentials
} from "../../core/types";
import {
  createOAuthClient,
  HTTPClient,
  type HttpResponse,
  throwXeroApiError
} from "../../core/utils";
import type { Xero } from "./models";

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

export interface XeroSettings {
  defaultSalesAccountCode?: string;
  defaultPurchaseAccountCode?: string;
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
  settings?: XeroSettings;
}> & {
  id: ProviderID.XERO;
  accessToken?: string;
  refreshToken?: string;
};

export class XeroProvider implements BaseProvider {
  static id = ProviderID.XERO;

  /**
   * Undeclared on purpose: absent capabilities = legacy REST provider (the
   * documented default in core/types.ts) — the drain treats Xero exactly
   * as before the field existed.
   */
  readonly capabilities?: ProviderCapabilities;

  http: HTTPClient;
  auth: AuthProvider;

  private readonly syncConfig!: GlobalSyncConfig;
  private readonly _settings: XeroSettings;

  constructor(public config: Omit<XeroProviderConfig, "id">) {
    this.syncConfig = config.syncConfig;
    this._settings = config.settings ?? {};
    logger.info("XeroProvider initialized", { settings: this._settings });
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

  /**
   * Get integration settings (e.g., default account codes).
   */
  get settings(): XeroSettings {
    return this._settings;
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
}
