import { z } from "zod";
import { ProviderID } from "../../core/models";
import type {
  AccountingEntityType,
  DimensionTarget,
  GlobalSyncConfig,
  ListChangesResult,
  ProviderCapabilities,
  ProviderChange,
  ProviderConfig,
  ProviderCredentials
} from "../../core/types";
import { BaseProvider } from "../../core/types";
import {
  AccountingApiError,
  type ApiErrorDetails,
  createOAuthClient,
  HTTPClient,
  type HttpResponse
} from "../../core/utils";
import { buildQboPaymentSyncChange } from "./entities/payment";
import {
  parseQboDate,
  type Qbo,
  type QboCreatePayload,
  type QboUpdatePayload
} from "./models";

const QBO_PRODUCTION_HOST = "https://quickbooks.api.intuit.com";
const QBO_SANDBOX_HOST = "https://sandbox-quickbooks.api.intuit.com";

/**
 * Intuit's OAuth2 bearer endpoint handles both the authorization-code
 * exchange and the refresh_token grant. It requires
 * `Authorization: Basic base64(clientId:clientSecret)` — which is exactly
 * what `createOAuthClient` sends.
 */
const QBO_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";

/** Pinned QBO API minor version — bump deliberately, in one place. */
export const QBO_MINOR_VERSION = "75";

/** QBO's hard upper bound for MAXRESULTS on /query. */
export const QBO_QUERY_MAX_RESULTS = 1000;

/**
 * Dimension slot target ids (stored on
 * settings.postingSync.dimensionSlots[].target): a slotted Carbon
 * dimension maps to the journal line's ClassRef or DepartmentRef.
 */
export const QBO_DIMENSION_TARGET_CLASS = "class";
export const QBO_DIMENSION_TARGET_DEPARTMENT = "department";

export type QboEnvironment = "sandbox" | "production";

// /********************************************************\
// *               QBO fault parsing                        *
// \********************************************************/

/**
 * Intuit fault codes the syncers branch on. Codes arrive as strings in the
 * Fault body (`Fault.Error[].code`).
 */
export const QBO_FAULT_CODES = {
  /** "Duplicate Name Exists Error" — QBO's shared name namespace (customers, vendors, employees, items). */
  DUPLICATE_NAME_EXISTS: "6240",
  /** "Stale Object Error" — the SyncToken sent is no longer current. */
  STALE_OBJECT: "5010",
  /** "Account Period Closed" — books are closed for the transaction date. */
  ACCOUNT_PERIOD_CLOSED: "6210"
} as const;

type QboFaultError = {
  Message?: string;
  Detail?: string;
  code?: string;
  element?: string;
};

type QboFaultBody = {
  Fault?: {
    Error?: QboFaultError[];
    type?: string;
  };
};

/**
 * Parse a QBO error response into structured ApiErrorDetails. QBO returns
 * `{ Fault: { Error: [{ Message, Detail, code, element }], type } }`;
 * OAuth-shaped errors and plain strings fall through with a best-effort
 * message.
 */
export function extractQboErrorDetails(
  statusCode: number,
  statusText: string,
  responseData: unknown
): ApiErrorDetails {
  const details: ApiErrorDetails = {
    statusCode,
    statusText,
    rawResponse: responseData
  };

  let data: unknown = responseData;
  if (typeof responseData === "string") {
    try {
      data = JSON.parse(responseData);
    } catch {
      if (responseData.length < 500) {
        details.providerMessage = responseData;
      }
      return details;
    }
  }

  if (typeof data !== "object" || data === null) {
    return details;
  }

  const fault = (data as QboFaultBody).Fault;
  if (fault) {
    if (typeof fault.type === "string") {
      details.providerErrorType = fault.type;
    }

    const errors = Array.isArray(fault.Error) ? fault.Error : [];
    const first = errors[0];
    if (first?.code !== undefined) {
      details.providerErrorCode = first.code;
    }
    if (first?.Message || first?.Detail) {
      details.providerMessage = first.Detail ?? first.Message;
    }

    const validationErrors = errors
      .filter((error) => error.Message || error.Detail)
      .map((error) => ({
        field: error.element || undefined,
        message: error.Detail ?? error.Message ?? ""
      }));
    if (validationErrors.length > 0) {
      details.validationErrors = validationErrors;
    }

    return details;
  }

  // OAuth-style error body
  const obj = data as Record<string, unknown>;
  if (typeof obj.error_description === "string") {
    details.providerMessage = obj.error_description;
    details.providerErrorType = obj.error as string;
  } else if (typeof obj.message === "string") {
    details.providerMessage = obj.message;
  }

  return details;
}

/**
 * Creates, logs and throws an AccountingApiError from a failed QBO
 * response (parallel to throwXeroApiError).
 */
export function throwQboApiError(
  operation: string,
  response: { error: boolean; message: string; code: number; data: unknown }
): never {
  const details = extractQboErrorDetails(
    response.code,
    response.message,
    response.data
  );

  const error = new AccountingApiError("quickbooks", operation, details);

  console.error(`[QBO API Error] ${operation}`, {
    statusCode: details.statusCode,
    statusText: details.statusText,
    providerErrorType: details.providerErrorType,
    providerErrorCode: details.providerErrorCode,
    providerMessage: details.providerMessage,
    validationErrors: details.validationErrors
  });

  throw error;
}

/** The Intuit fault code carried by a thrown AccountingApiError, if any. */
export function getQboFaultCode(error: unknown): string | null {
  if (!(error instanceof AccountingApiError)) return null;
  const code = error.details.providerErrorCode;
  return code === undefined ? null : String(code);
}

/** True for QBO's Duplicate Name Exists fault (Intuit code 6240). */
export function isQboDuplicateNameError(error: unknown): boolean {
  return getQboFaultCode(error) === QBO_FAULT_CODES.DUPLICATE_NAME_EXISTS;
}

/** True for QBO's Stale Object fault (Intuit code 5010 — stale SyncToken). */
export function isQboStaleObjectError(error: unknown): boolean {
  return getQboFaultCode(error) === QBO_FAULT_CODES.STALE_OBJECT;
}

/**
 * True for QBO's Account Period Closed fault (Intuit code 6210 — the books
 * are closed for the transaction date).
 */
export function isQboAccountPeriodClosedError(error: unknown): boolean {
  return getQboFaultCode(error) === QBO_FAULT_CODES.ACCOUNT_PERIOD_CLOSED;
}

/**
 * Envelope returned by GET /query. The page rows live under the entity
 * name (e.g. `QueryResponse.Customer`).
 */
export type QboQueryResponse = {
  QueryResponse?: {
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  } & Record<string, unknown>;
  time?: string;
};

function getOAuth2Credentials(
  credentials: ProviderCredentials
): Extract<ProviderCredentials, { type: "oauth2" }> {
  if (credentials.type !== "oauth2") {
    throw new Error(
      `QuickBooks Online requires oauth2 credentials, received "${credentials.type}"`
    );
  }
  return credentials;
}

/**
 * QBO stores its company id under `providerMetadata.realmId` (captured from
 * the OAuth callback query params). Throws when it is missing — every QBO
 * API path embeds the realm, and a descriptive error beats an opaque 401.
 */
function getQboRealmId(
  credentials: ProviderCredentials,
  fallbackRealmId?: string
): string {
  const { providerMetadata } = getOAuth2Credentials(credentials);
  const metadataRealmId = providerMetadata?.realmId;
  const realmId =
    typeof metadataRealmId === "string" && metadataRealmId.length > 0
      ? metadataRealmId
      : fallbackRealmId;

  if (!realmId) {
    throw new Error(
      "QuickBooks Online credentials are missing realmId (providerMetadata.realmId). Reconnect the QuickBooks Online integration to select a company."
    );
  }

  return realmId;
}

/**
 * Every QBO endpoint lives under /v3/company/{realmId} and carries the
 * pinned minorversion query param.
 */
function buildCompanyPath(realmId: string, url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `/v3/company/${realmId}${url}${separator}minorversion=${QBO_MINOR_VERSION}`;
}

type QboProviderConfig = ProviderConfig<{
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  realmId?: string;
  /** Selects the Intuit host; production unless explicitly "sandbox". */
  environment?: QboEnvironment;
}> & {
  id: ProviderID.QUICKBOOKS;
  accessToken?: string;
  refreshToken?: string;
};

/**
 * Entities QBO syncs TWO-WAY: `payment`. Inbound (pull) — QBO Payment/BillPayment
 * settlements flow back onto Carbon sales/purchase invoices (Phase F). Outbound
 * (push) — Carbon-born Posted payments are written to QBO as Payment/BillPayment
 * documents so the settled invoice/bill closes (Phase G). Which direction fires
 * per record is decided by origin: a payment already carrying a `payment`
 * mapping is provider-known and skips push; a mapping-less Carbon payment is
 * pushed. Forced two-way AND enabled — both halves must work as soon as the
 * integration is connected (there is no per-company toggle for it; the
 * documents-mode families gate governs whether it actually runs). Mirrors
 * Rillet's RILLET_TWO_WAY_ENTITIES.
 */
export const QBO_TWO_WAY_ENTITIES = [
  "payment"
] as const satisfies readonly AccountingEntityType[];

/**
 * Master + document entities for which Carbon is the system of record:
 * customers, vendors, items, sales invoices, and bills. Forced
 * `push-to-accounting` / `owner: "carbon"` so QBO is a downstream mirror —
 * Carbon's edits always win, and an inbound QBO change to a linked record is
 * skipped by BaseEntitySyncer's owner guard. This is the standardized "Carbon
 * owns everything" stance that replaced the per-entity Source of Truth setting;
 * it mirrors Rillet's RILLET_PUSH_ONLY_ENTITIES. Their per-company `enabled`
 * flag survives — this constrains ownership, not whether they sync. `payment`
 * is deliberately excluded: the accounting system owns payments (see
 * QBO_TWO_WAY_ENTITIES).
 */
export const QBO_CARBON_OWNED_ENTITIES = [
  "customer",
  "vendor",
  "item",
  "invoice",
  "bill"
] as const satisfies readonly AccountingEntityType[];

/**
 * Overlay QBO's capability + ownership forcing on a resolved sync config:
 * customers/vendors/items/invoices/bills forced push-only + owner "carbon"
 * (Carbon owns them); `payment` forced two-way + enabled (the accounting system
 * owns it; Carbon-born payments push back out — Phase G). Every other entity
 * keeps its resolved config.
 */
export function buildQboSyncConfig(
  resolved: GlobalSyncConfig
): GlobalSyncConfig {
  const entities = Object.fromEntries(
    Object.entries(resolved.entities).map(([entityType, entityConfig]) => [
      entityType,
      { ...entityConfig }
    ])
  ) as GlobalSyncConfig["entities"];

  for (const entityType of QBO_CARBON_OWNED_ENTITIES) {
    entities[entityType] = {
      ...entities[entityType],
      direction: "push-to-accounting",
      owner: "carbon"
    };
  }

  for (const entityType of QBO_TWO_WAY_ENTITIES) {
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

export class QboProvider extends BaseProvider {
  static id = ProviderID.QUICKBOOKS;

  readonly capabilities: ProviderCapabilities = {
    transport: "rest",
    supportsWebhooks: false,
    supportsJournalPush: true,
    // One ClassRef + one DepartmentRef per journal line — 2 fixed slots
    maxJournalDimensionSlots: 2
  };

  http: HTTPClient;

  private readonly syncConfig!: GlobalSyncConfig;

  constructor(public config: Omit<QboProviderConfig, "id">) {
    super();
    // `payment` is forced two-way + enabled (see buildQboSyncConfig).
    this.syncConfig = buildQboSyncConfig(config.syncConfig);
    this.http = new HTTPClient(
      config.environment === "sandbox" ? QBO_SANDBOX_HOST : QBO_PRODUCTION_HOST
    );
    this.auth = createOAuthClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      redirectUri: config.redirectUri,
      tokenUrl: QBO_TOKEN_URL,
      onTokenRefresh: config.onTokenRefresh,
      getAuthUrl(scopes: string[], redirectURL: string): string {
        const params = new URLSearchParams({
          response_type: "code",
          client_id: config.clientId,
          redirect_uri: redirectURL,
          scope: scopes.join(" "),
          state: crypto.randomUUID()
        });

        return `${QBO_AUTHORIZE_URL}?${params.toString()}`;
      }
    });
  }

  get id(): ProviderID.QUICKBOOKS {
    return ProviderID.QUICKBOOKS;
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
    const realmId = getQboRealmId(credentials, this.config.realmId);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...((options?.headers ?? {}) as Record<string, string>)
    };

    const path = buildCompanyPath(realmId, url);

    const response = await this.http.request<T>(method, path, {
      ...options,
      headers
    });

    if (response.code === 401) {
      // Single retry: refresh via Intuit's refresh_token grant (Basic auth,
      // handled by createOAuthClient which persists the new tokens through
      // the onTokenRefresh callback), then replay the request once.
      await this.auth.refresh();

      const { accessToken: refreshedAccessToken } = getOAuth2Credentials(
        this.auth.getCredentials()
      );

      const retryHeaders: Record<string, string> = {
        ...headers,
        Authorization: `Bearer ${refreshedAccessToken}`
      };

      return this.http.request<T>(method, path, {
        ...options,
        headers: retryHeaders
      });
    }

    return response;
  }

  /**
   * Run a QBO query (`SELECT * FROM <entity> [WHERE ...]`) and page through
   * the results with STARTPOSITION/MAXRESULTS until a short page signals
   * the end. `maxResults` is the page size, capped at QBO's limit of 1000.
   */
  async query<T>(
    entity: string,
    where?: string,
    startPosition = 1,
    maxResults = QBO_QUERY_MAX_RESULTS
  ): Promise<T[]> {
    const pageSize = Math.max(1, Math.min(maxResults, QBO_QUERY_MAX_RESULTS));
    const rows: T[] = [];
    let position = startPosition;

    while (true) {
      const statement = `SELECT * FROM ${entity}${
        where ? ` WHERE ${where}` : ""
      } STARTPOSITION ${position} MAXRESULTS ${pageSize}`;

      const response = await this.request<QboQueryResponse>(
        "GET",
        `/query?query=${encodeURIComponent(statement)}`
      );

      if (response.error) {
        throw new AccountingApiError("quickbooks", `query ${entity}`, {
          statusCode: response.code,
          statusText: response.message,
          rawResponse: response.data
        });
      }

      const page =
        (response.data?.QueryResponse?.[entity] as T[] | undefined) ?? [];
      rows.push(...page);

      if (page.length < pageSize) break;
      position += pageSize;
    }

    return rows;
  }

  async validate(): Promise<boolean> {
    try {
      const companyInfo = await this.getCompanyInfo();
      return companyInfo !== null;
    } catch (error) {
      console.error("QuickBooks Online validate error:", error);
      return false;
    }
  }

  /**
   * Fetch the QBO company profile (GET /companyinfo/{realmId}).
   * Returns null when the request fails.
   */
  async getCompanyInfo(): Promise<Qbo.CompanyInfo | null> {
    const realmId = getQboRealmId(
      this.auth.getCredentials(),
      this.config.realmId
    );

    const response = await this.request<{ CompanyInfo: Qbo.CompanyInfo }>(
      "GET",
      `/companyinfo/${realmId}`
    );

    if (response.error || !response.data?.CompanyInfo) {
      return null;
    }

    return response.data.CompanyInfo;
  }

  // =================================================================
  // Chart of accounts
  // =================================================================

  /**
   * Fetch the active QBO chart of accounts, normalized to the
   * `{ id, code, name }` shape the settings loader / account-mapping UI
   * consumes (the same shape it builds from XeroProvider's raw list).
   * QBO account numbers (`AcctNum`) are optional — `code` falls back to
   * the account `Id`. Returns [] on failure, mirroring Xero's forgiving
   * contract.
   */
  async listChartOfAccounts(): Promise<
    Array<{ id: string; code: string; name: string }>
  > {
    try {
      const accounts = await this.query<Qbo.Account>(
        "Account",
        "Active = true"
      );
      return accounts.map((account) => ({
        id: account.Id,
        code: account.AcctNum ?? account.Id,
        name: account.Name
      }));
    } catch (error) {
      console.error("Failed to fetch QuickBooks Online accounts:", error);
      return [];
    }
  }

  // =================================================================
  // Entity reads/writes (create = POST /{entity}; update = the same POST
  // echoing Id + the current SyncToken, sent sparse so unspecified fields
  // are preserved — the intent Xero's full-payload POST updates carry)
  // =================================================================

  private async readEntity<T>(
    resource: string,
    envelopeKey: string,
    id: string
  ): Promise<T | null> {
    const response = await this.request<Record<string, T>>(
      "GET",
      `/${resource}/${id}`
    );
    if (response.error) return null;
    return response.data?.[envelopeKey] ?? null;
  }

  private async writeEntity<T>(
    resource: string,
    envelopeKey: string,
    operation: string,
    payload: unknown
  ): Promise<T> {
    const response = await this.request<Record<string, T>>(
      "POST",
      `/${resource}`,
      { body: JSON.stringify(payload) }
    );

    if (response.error) {
      throwQboApiError(operation, response);
    }

    const entity = response.data?.[envelopeKey];
    if (!entity) {
      throw new Error(
        `QuickBooks Online returned success but no ${envelopeKey} was returned for ${operation}`
      );
    }

    return entity;
  }

  private updateBody<T extends { Id: string; SyncToken: string }>(
    payload: T
  ): T & { sparse: true } {
    return { ...payload, sparse: true };
  }

  async getCustomer(id: string): Promise<Qbo.Customer | null> {
    return this.readEntity<Qbo.Customer>("customer", "Customer", id);
  }

  async createCustomer(
    customer: QboCreatePayload<Qbo.Customer>
  ): Promise<Qbo.Customer> {
    return this.writeEntity(
      "customer",
      "Customer",
      "create customer",
      customer
    );
  }

  async updateCustomer(
    customer: QboUpdatePayload<Qbo.Customer>
  ): Promise<Qbo.Customer> {
    return this.writeEntity(
      "customer",
      "Customer",
      "update customer",
      this.updateBody(customer)
    );
  }

  async getVendor(id: string): Promise<Qbo.Vendor | null> {
    return this.readEntity<Qbo.Vendor>("vendor", "Vendor", id);
  }

  async createVendor(
    vendor: QboCreatePayload<Qbo.Vendor>
  ): Promise<Qbo.Vendor> {
    return this.writeEntity("vendor", "Vendor", "create vendor", vendor);
  }

  async updateVendor(
    vendor: QboUpdatePayload<Qbo.Vendor>
  ): Promise<Qbo.Vendor> {
    return this.writeEntity(
      "vendor",
      "Vendor",
      "update vendor",
      this.updateBody(vendor)
    );
  }

  async getItem(id: string): Promise<Qbo.Item | null> {
    return this.readEntity<Qbo.Item>("item", "Item", id);
  }

  async createItem(item: QboCreatePayload<Qbo.Item>): Promise<Qbo.Item> {
    return this.writeEntity("item", "Item", "create item", item);
  }

  async updateItem(item: QboUpdatePayload<Qbo.Item>): Promise<Qbo.Item> {
    return this.writeEntity(
      "item",
      "Item",
      "update item",
      this.updateBody(item)
    );
  }

  async getInvoice(id: string): Promise<Qbo.Invoice | null> {
    return this.readEntity<Qbo.Invoice>("invoice", "Invoice", id);
  }

  async createInvoice(
    invoice: QboCreatePayload<Qbo.Invoice>
  ): Promise<Qbo.Invoice> {
    return this.writeEntity("invoice", "Invoice", "create invoice", invoice);
  }

  async updateInvoice(
    invoice: QboUpdatePayload<Qbo.Invoice>
  ): Promise<Qbo.Invoice> {
    return this.writeEntity(
      "invoice",
      "Invoice",
      "update invoice",
      this.updateBody(invoice)
    );
  }

  async getBill(id: string): Promise<Qbo.Bill | null> {
    return this.readEntity<Qbo.Bill>("bill", "Bill", id);
  }

  async createBill(bill: QboCreatePayload<Qbo.Bill>): Promise<Qbo.Bill> {
    return this.writeEntity("bill", "Bill", "create bill", bill);
  }

  async updateBill(bill: QboUpdatePayload<Qbo.Bill>): Promise<Qbo.Bill> {
    return this.writeEntity(
      "bill",
      "Bill",
      "update bill",
      this.updateBody(bill)
    );
  }

  async getPurchaseOrder(id: string): Promise<Qbo.PurchaseOrder | null> {
    return this.readEntity<Qbo.PurchaseOrder>(
      "purchaseorder",
      "PurchaseOrder",
      id
    );
  }

  async createPurchaseOrder(
    purchaseOrder: QboCreatePayload<Qbo.PurchaseOrder>
  ): Promise<Qbo.PurchaseOrder> {
    return this.writeEntity(
      "purchaseorder",
      "PurchaseOrder",
      "create purchase order",
      purchaseOrder
    );
  }

  async updatePurchaseOrder(
    purchaseOrder: QboUpdatePayload<Qbo.PurchaseOrder>
  ): Promise<Qbo.PurchaseOrder> {
    return this.writeEntity(
      "purchaseorder",
      "PurchaseOrder",
      "update purchase order",
      this.updateBody(purchaseOrder)
    );
  }

  // =================================================================
  // Payments (two-way) — directly addressable by id
  // =================================================================

  /** GET /payment/{id} — a QBO Payment (Accounts Receivable). */
  async getPayment(id: string): Promise<Qbo.Payment | null> {
    return this.readEntity<Qbo.Payment>("payment", "Payment", id);
  }

  /** GET /billpayment/{id} — a QBO BillPayment (Accounts Payable). */
  async getBillPayment(id: string): Promise<Qbo.BillPayment | null> {
    return this.readEntity<Qbo.BillPayment>("billpayment", "BillPayment", id);
  }

  /**
   * Create a QBO Payment (POST /payment) — a customer payment applied to
   * Invoice(s) via `Line[].LinkedTxn{TxnType:"Invoice"}` (Phase G AR
   * write-back). The write payload carries CustomerRef + DepositToAccountRef,
   * which the read schema omits; writeEntity sends it as-is and QBO echoes back
   * the created Payment. Returns the created payment Id.
   */
  async createPayment(payload: QboPaymentCreatePayload): Promise<string> {
    const created = await this.writeEntity<Qbo.Payment>(
      "payment",
      "Payment",
      "create payment",
      payload
    );
    return created.Id;
  }

  /**
   * Create a QBO BillPayment (POST /billpayment) — a vendor payment applied to
   * Bill(s) via `Line[].LinkedTxn{TxnType:"Bill"}` (Phase G AP write-back). The
   * write payload carries VendorRef + PayType/CheckPayment, which the read
   * schema omits; writeEntity sends it as-is and QBO echoes back the created
   * BillPayment. Returns the created bill-payment Id.
   */
  async createBillPayment(
    payload: QboBillPaymentCreatePayload
  ): Promise<string> {
    const created = await this.writeEntity<Qbo.BillPayment>(
      "billpayment",
      "BillPayment",
      "create bill payment",
      payload
    );
    return created.Id;
  }

  async getJournalEntry(id: string): Promise<Qbo.JournalEntry | null> {
    return this.readEntity<Qbo.JournalEntry>(
      "journalentry",
      "JournalEntry",
      id
    );
  }

  /**
   * Create a QBO journal entry. No update counterpart: pushed journals are
   * immutable (the journal syncer hard-skips already-mapped ids), so the
   * SyncToken echo path never applies.
   */
  async createJournalEntry(
    journalEntry: QboCreatePayload<Qbo.JournalEntry>
  ): Promise<Qbo.JournalEntry> {
    return this.writeEntity(
      "journalentry",
      "JournalEntry",
      "create journal entry",
      journalEntry
    );
  }

  // =================================================================
  // Dimensions (Class / Department)
  // =================================================================

  /**
   * Active QBO Classes. Class tracking is feature-gated by the Intuit
   * plan — a query failure means the org doesn't have the feature, so
   * this returns [] instead of hard-failing (the settings UI then offers
   * no "class" target).
   */
  async listClasses(): Promise<Qbo.Class[]> {
    try {
      return await this.query<Qbo.Class>("Class", "Active = true");
    } catch (error) {
      console.warn(
        "Failed to fetch QuickBooks Online classes (class tracking likely unavailable on this plan):",
        error
      );
      return [];
    }
  }

  /**
   * Active QBO Departments (a.k.a. Locations). Same forgiving contract
   * as listClasses — [] when the feature is off.
   */
  async listDepartments(): Promise<Qbo.Department[]> {
    try {
      return await this.query<Qbo.Department>("Department", "Active = true");
    } catch (error) {
      console.warn(
        "Failed to fetch QuickBooks Online departments (location tracking likely unavailable on this plan):",
        error
      );
      return [];
    }
  }

  /** Create a QBO Class by name (dimension autoCreate). Throws on failure. */
  async createClass(payload: QboCreatePayload<Qbo.Class>): Promise<Qbo.Class> {
    return this.writeEntity("class", "Class", "create class", payload);
  }

  /** Create a QBO Department by name (dimension autoCreate). Throws on failure. */
  async createDepartment(
    payload: QboCreatePayload<Qbo.Department>
  ): Promise<Qbo.Department> {
    return this.writeEntity(
      "department",
      "Department",
      "create department",
      payload
    );
  }

  /**
   * The journal dimension targets this org actually supports: `class`
   * and/or `department`, each verified by a probe query so orgs without
   * the Intuit feature see an empty (or reduced) target list instead of a
   * push-time failure. A feature that is on but has no values yet still
   * yields its target.
   */
  async journalDimensionTargets(): Promise<DimensionTarget[]> {
    const targets: DimensionTarget[] = [];

    try {
      await this.query<Qbo.Class>("Class", "Active = true", 1, 1);
      targets.push({ id: QBO_DIMENSION_TARGET_CLASS, label: "Class" });
    } catch (error) {
      console.warn("QBO class tracking unavailable; omitting target:", error);
    }

    try {
      await this.query<Qbo.Department>("Department", "Active = true", 1, 1);
      targets.push({
        id: QBO_DIMENSION_TARGET_DEPARTMENT,
        label: "Department"
      });
    } catch (error) {
      console.warn(
        "QBO department tracking unavailable; omitting target:",
        error
      );
    }

    return targets;
  }

  // =================================================================
  // Change Data Capture
  // =================================================================

  /**
   * QBO Change Data Capture (GET /cdc): every entity of the requested
   * types changed since `changedSince` (ISO 8601; QBO reaches back at
   * most 30 days). The response nests one QueryResponse per entity type
   * under CDCResponse, mixing full objects with `status: "Deleted"`
   * tombstone stubs. Only identity fields are parsed — the pull syncers
   * refetch full objects by id — so each change normalizes to
   * `{ entityName, id, deleted, lastUpdatedTime }`. Records failing even
   * the minimal parse are logged and skipped.
   */
  async changeDataCapture(
    entities: string[],
    changedSince: string
  ): Promise<QboChangeDataCaptureEntry[]> {
    const response = await this.request<QboCdcResponse>(
      "GET",
      `/cdc?entities=${encodeURIComponent(
        entities.join(",")
      )}&changedSince=${encodeURIComponent(changedSince)}`
    );

    if (response.error) {
      throwQboApiError("change data capture", response);
    }

    const changes: QboChangeDataCaptureEntry[] = [];

    for (const cdcResponse of response.data?.CDCResponse ?? []) {
      for (const queryResponse of cdcResponse?.QueryResponse ?? []) {
        if (!queryResponse || typeof queryResponse !== "object") continue;

        for (const entityName of entities) {
          const records = (queryResponse as Record<string, unknown>)[
            entityName
          ];
          if (!Array.isArray(records)) continue;

          for (const record of records) {
            const parsed = CdcRecordSchema.safeParse(record);
            if (!parsed.success) {
              console.warn(
                `[QBO CDC] Skipping unparseable ${entityName} record:`,
                parsed.error.issues
              );
              continue;
            }

            changes.push({
              entityName,
              id: parsed.data.Id,
              deleted: parsed.data.status === "Deleted",
              lastUpdatedTime: parsed.data.MetaData?.LastUpdatedTime ?? null
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * QBO's CDC endpoint reaches back at most 30 days; clamped to 29 to
   * keep a margin for clock skew and call latency.
   */
  readonly pullLookbackDays = 29;

  /**
   * SupportsIncrementalPull: CDC changes for every entity whose RESOLVED
   * sync config direction includes pull, normalized for the generic
   * accounting-pull-sweep cron. Push-only entities (item and
   * purchaseOrder under the defaults) never flow QBO → Carbon and are not
   * fetched. Unknown entity names are logged and dropped.
   */
  async listChanges(args: { since: string }): Promise<ListChangesResult> {
    const entityNames = (
      Object.keys(QBO_CDC_ENTITY_TYPES) as QboCdcEntityName[]
    ).filter((entityName) => {
      const entityConfig = this.getSyncConfig(QBO_CDC_ENTITY_TYPES[entityName]);
      return (
        entityConfig.enabled &&
        (entityConfig.direction === "pull-from-accounting" ||
          entityConfig.direction === "two-way")
      );
    });

    if (entityNames.length === 0) {
      return { changes: [] };
    }

    const entries = await this.changeDataCapture(entityNames, args.since);

    const changes: ProviderChange[] = [];
    for (const entry of entries) {
      const entityType =
        (QBO_CDC_ENTITY_TYPES as Record<string, AccountingEntityType>)[
          entry.entityName
        ] ?? null;
      if (!entityType) {
        console.warn(
          `[QBO] ignoring CDC change for unmapped entity "${entry.entityName}"`
        );
        continue;
      }

      // Payments (Payment / BillPayment) need the settled document to build the
      // composite entity id + dependency; CDC only carries the payment id, so
      // refetch the object.
      if (entityType === "payment") {
        const change = await this.buildPaymentChange(entry);
        if (change) changes.push(change);
        continue;
      }

      changes.push({
        entityType,
        remoteId: entry.id,
        updatedAt: entry.lastUpdatedTime,
        deleted: entry.deleted
      });
    }

    return { changes };
  }

  /**
   * Turn a CDC Payment/BillPayment entry into a `payment` ProviderChange with
   * the canonical composite id (`<invoiceId>:<paymentId>` /
   * `bill:<billId>:<paymentId>`) + a `dependsOnMapping` on the primary settled
   * document. Refetches the payment (CDC carries only the id) — the SAME
   * composite the notification-only webhook builds, so webhook + CDC dedupe on
   * the one `payment` mapping. A hard-deleted stub (`entry.deleted`) is emitted
   * as a bare-id deleted-flagged change WITHOUT refetching (the sweep turns it
   * into a void); returns null (logged) only for a live payment that settles no
   * Bill/Invoice.
   */
  private async buildPaymentChange(
    entry: QboChangeDataCaptureEntry
  ): Promise<ProviderChange | null> {
    if (entry.deleted) {
      // A hard-deleted Payment/BillPayment CDC stub carries only its bare id
      // (no lines, and a refetch would 404), so the composite entity id can't
      // be rebuilt here. Emit a deleted-flagged change carrying the BARE
      // payment id; the pull sweep resolves the composite(s) from the existing
      // payment mapping (suffix match) and enqueues the reversing void pull.
      // No dependsOnMapping — the settled document is unknown from a tombstone.
      return {
        entityType: "payment",
        remoteId: entry.id,
        updatedAt: entry.lastUpdatedTime,
        deleted: true
      };
    }

    const family = entry.entityName === "BillPayment" ? "ap" : "ar";
    const remote =
      family === "ap"
        ? await this.getBillPayment(entry.id)
        : await this.getPayment(entry.id);
    if (!remote) {
      console.warn(
        `[QBO] ${entry.entityName} ${entry.id} not found on refetch — skipping`
      );
      return null;
    }

    const built = buildQboPaymentSyncChange(remote, family);
    if (!built) {
      console.warn(
        `[QBO] ${entry.entityName} ${entry.id} settles no ${
          family === "ap" ? "Bill" : "Invoice"
        } — skipping`
      );
      return null;
    }

    return {
      entityType: "payment",
      remoteId: built.entityId,
      updatedAt:
        parseQboDate(remote.MetaData?.LastUpdatedTime)?.toISOString() ??
        entry.lastUpdatedTime,
      dependsOnMapping: {
        entityType: family === "ap" ? "bill" : "invoice",
        remoteId: built.documentRemoteId
      }
    };
  }
}

/**
 * QBO CDC entity names → Carbon entity types. `Payment` (AR) and `BillPayment`
 * (AP) both map to the single `payment` entity type — the payment syncer
 * discriminates family from the composite id / object shape.
 *
 * VERIFY(sandbox): confirm QBO CDC actually returns `BillPayment` deltas (and
 * `Payment` deltas) within the 29-day window; research says yes, but Intuit's
 * CDC-supported-entity list has historically shifted.
 */
export const QBO_CDC_ENTITY_TYPES = {
  Customer: "customer",
  Vendor: "vendor",
  Item: "item",
  Invoice: "invoice",
  Bill: "bill",
  PurchaseOrder: "purchaseOrder",
  Payment: "payment",
  BillPayment: "payment"
} as const satisfies Record<string, AccountingEntityType>;

export type QboCdcEntityName = keyof typeof QBO_CDC_ENTITY_TYPES;

/**
 * Write payload for POST /payment (Phase G AR outbound write-back). QBO
 * requires CustomerRef (the payer) and a DepositToAccountRef (the bank the
 * receipt lands in); each `Line` applies its `Amount` to an Invoice via
 * LinkedTxn. Deliberately structural (not QboCreatePayload<Qbo.Payment>) — the
 * read schema omits these write-only refs.
 */
export type QboPaymentCreatePayload = {
  CustomerRef: Qbo.Ref;
  TotalAmt: number;
  TxnDate: string;
  DepositToAccountRef: Qbo.Ref;
  Line: Qbo.PaymentLine[];
};

/**
 * Write payload for POST /billpayment (Phase G AP outbound write-back). QBO
 * requires VendorRef (the payee) and a PayType with the matching detail; a
 * "Check" payment carries CheckPayment.BankAccountRef (the bank the
 * disbursement clears through). Each `Line` applies its `Amount` to a Bill via
 * LinkedTxn.
 */
export type QboBillPaymentCreatePayload = {
  VendorRef: Qbo.Ref;
  TotalAmt: number;
  TxnDate: string;
  PayType: "Check";
  CheckPayment: { BankAccountRef: Qbo.Ref };
  Line: Qbo.PaymentLine[];
};

/**
 * Envelope returned by GET /cdc. Each CDCResponse carries one
 * QueryResponse per changed entity type; entity rows live under the
 * entity name exactly like /query — full objects for live records,
 * `{ Id, status: "Deleted", MetaData }` tombstone stubs for deletes.
 */
type QboCdcResponse = {
  CDCResponse?: Array<{
    QueryResponse?: Array<Record<string, unknown> | null>;
  } | null>;
  time?: string;
};

/**
 * Minimal identity parse of one CDC record (the pull syncers refetch full
 * objects by id): `Id`, the Deleted-stub marker, and
 * `MetaData.LastUpdatedTime` for the CDC cron's cursor math.
 */
const CdcRecordSchema = z.object({
  Id: z.string(),
  status: z.string().optional(),
  MetaData: z.object({ LastUpdatedTime: z.string().optional() }).optional()
});

/** One normalized CDC change. */
export type QboChangeDataCaptureEntry = {
  /** QBO entity name as requested, e.g. "Customer". */
  entityName: string;
  /** QBO entity Id — the remote id Carbon maps against. */
  id: string;
  /** True for QBO's `status: "Deleted"` tombstone stubs. */
  deleted: boolean;
  /** MetaData.LastUpdatedTime (ISO 8601 with offset), when present. */
  lastUpdatedTime: string | null;
};
