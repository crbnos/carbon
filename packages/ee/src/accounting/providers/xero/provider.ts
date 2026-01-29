import { ProviderID } from "../../core/models";
import type {
  AccountingEntityType,
  AuthProvider,
  BaseProvider,
  GlobalSyncConfig,
  ProviderConfig,
  ProviderCredentials
} from "../../core/types";
import { createOAuthClient, HTTPClient } from "../../core/utils";
import type { Xero } from "./models";

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

export class XeroProvider implements BaseProvider {
  static id = ProviderID.XERO;

  http: HTTPClient;
  auth: AuthProvider;

  private readonly syncConfig!: GlobalSyncConfig;

  constructor(public config: Omit<XeroProviderConfig, "id">) {
    this.syncConfig = config.syncConfig;
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

  async request<T>(method: string, url: string, options?: RequestInit) {
    const { accessToken, ...creds } = this.auth.getCredentials();

    const tenantId = creds.tenantId || this.config.tenantId;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...((options?.headers ?? {}) as Record<string, string>)
    };

    if (tenantId) {
      headers["xero-tenant-id"] = tenantId;
    }

    const response = await this.http.request<T>(method, url, {
      ...options,
      headers: headers
    });

    if (response.code === 401) {
      await this.auth.refresh();

      const c = this.auth.getCredentials();

      const retryHeaders: Record<string, string> = {
        ...headers,
        Authorization: `Bearer ${c.accessToken}`
      };

      if (tenantId) {
        retryHeaders["xero-tenant-id"] = tenantId;
      }

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
      console.error("Xero validate error:", error);
      return false;
    }
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
