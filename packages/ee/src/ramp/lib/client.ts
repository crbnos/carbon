import { createHash } from "node:crypto";
import { z } from "zod";
import type { RampCredentials } from "./models";
import {
  RampBillSchema,
  RampCashbackSchema,
  RampReimbursementSchema,
  RampRepaymentSchema,
  RampTransactionSchema,
  RampTransferSchema,
  RampVendorSchema
} from "./models";

export const RAMP_PRODUCTION_HOST = "https://api.ramp.com";
export const RAMP_SANDBOX_HOST = "https://demo-api.ramp.com";

/**
 * OAuth scopes requested for the client-credentials token (spec §Auth). Kept as
 * an array so it reads cleanly; sent space-joined on the token request.
 */
export const RAMP_SCOPES = [
  "accounting:read",
  "accounting:write",
  "transactions:read",
  "bills:read",
  "bills:write",
  "vendors:read",
  "vendors:write",
  "reimbursements:read",
  "purchase_orders:read",
  "purchase_orders:write",
  "transfers:read",
  "statements:read",
  "cashbacks:read",
  "receipts:read",
  "entities:read",
  "business:read"
] as const;

/**
 * Scopes requested in the OAuth authorization-code (Connect) flow. Same resource
 * scopes as client-credentials, plus `offline_access` so Ramp returns a refresh
 * token (the app must also have the Refresh Token grant enabled).
 */
export const RAMP_OAUTH_SCOPES = [...RAMP_SCOPES, "offline_access"] as const;

/** Ramp OAuth authorize endpoints (production / sandbox). */
export const RAMP_PRODUCTION_AUTHORIZE_URL = `${RAMP_PRODUCTION_HOST}/v1/authorize`;
export const RAMP_SANDBOX_AUTHORIZE_URL = `${RAMP_SANDBOX_HOST}/v1/authorize`;

/** Re-mint a client-credentials token when fewer than this many ms remain. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Ramp's cursor-pagination page-size cap. */
const RAMP_PAGE_SIZE = 100;

// /********************************************************\
// *                       Errors                           *
// \********************************************************/

/** Non-2xx Ramp response (parsed from the `error_v2` envelope). */
export class RampApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(`Ramp API error ${status}${code ? ` (${code})` : ""}: ${message}`);
    this.name = "RampApiError";
    this.status = status;
    this.code = code;
  }
}

/** A 429 from Ramp — carries the parsed `Retry-After` (seconds). */
export class RampRateLimitError extends Error {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Ramp rate limit exceeded — retry after ${retryAfterSeconds}s`);
    this.name = "RampRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type SearchParamsInit =
  | URLSearchParams
  | Record<string, string | number | boolean | undefined>;

type RequestOptions = {
  body?: unknown;
  searchParams?: SearchParamsInit;
  idempotencyKey?: string;
};

function toSearchParams(init?: SearchParamsInit): URLSearchParams {
  if (!init) return new URLSearchParams();
  if (init instanceof URLSearchParams) return new URLSearchParams(init);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(init)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  return params;
}

// /********************************************************\
// *                      RampClient                        *
// \********************************************************/

/**
 * Server-only wiring for the OAuth2 (authorization-code) path. `oauthApp` is
 * Carbon's single registered Ramp OAuth application (client id/secret from env,
 * NOT the customer's) — required to exchange a code and to refresh. Refresh
 * tokens are NOT rotated by Ramp (a refresh returns a new access token only), so
 * `onTokensRefreshed` persists just the new access token + expiry; the refresh
 * token is unchanged.
 */
export type RampClientOptions = {
  oauthApp?: { clientId: string; clientSecret: string };
  onTokensRefreshed?: (tokens: {
    accessToken: string;
    expiresAt: string;
  }) => void | Promise<void>;
};

export class RampClient {
  private readonly host: string;
  private accessToken?: string;
  /** Epoch ms at which the cached token expires. */
  private tokenExpiresAt?: number;
  /** Live oauth2 token state (mutated on refresh). */
  private oauthAccessToken?: string;
  private oauthExpiresAt?: number;

  constructor(
    private readonly credentials: RampCredentials,
    private readonly options: RampClientOptions = {}
  ) {
    this.host =
      credentials.environment === "sandbox"
        ? RAMP_SANDBOX_HOST
        : RAMP_PRODUCTION_HOST;
    if (credentials.type === "oauth2") {
      this.oauthAccessToken = credentials.accessToken;
      this.oauthExpiresAt = credentials.expiresAt
        ? Date.parse(credentials.expiresAt)
        : undefined;
    }
  }

  /**
   * Exchange an OAuth authorization code for tokens (the Connect-flow callback).
   * Uses Carbon's OAuth app credentials with HTTP Basic auth.
   */
  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  }> {
    const data = await this.oauthTokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined
    };
  }

  /** POST /token with Carbon's OAuth app credentials (Basic auth). */
  private async oauthTokenRequest(body: Record<string, string>): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }> {
    const app = this.options.oauthApp;
    if (!app?.clientId || !app?.clientSecret) {
      throw new Error(
        "Ramp OAuth app credentials are not configured (RAMP_CLIENT_ID / RAMP_CLIENT_SECRET)"
      );
    }
    const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString(
      "base64"
    );
    const response = await fetch(`${this.host}/developer/v1/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams(body)
    });
    if (response.status === 429) {
      throw new RampRateLimitError(parseRetryAfter(response));
    }
    if (!response.ok) {
      await throwRampApiError(response);
    }
    return (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
  }

  /**
   * Return a valid bearer token. client_credentials mints/caches (re-minting
   * under the refresh margin). oauth2 returns the stored access token, and when
   * it is within the refresh margin runs the `refresh_token` grant, persisting
   * the new access token via `onTokensRefreshed`.
   */
  private async getAccessToken(): Promise<string> {
    if (this.credentials.type === "oauth2") {
      const now = Date.now();
      if (
        this.oauthAccessToken &&
        (this.oauthExpiresAt === undefined ||
          this.oauthExpiresAt - now > TOKEN_REFRESH_MARGIN_MS)
      ) {
        return this.oauthAccessToken;
      }

      const { refreshToken } = this.credentials;
      if (!refreshToken) {
        throw new Error(
          "Ramp OAuth access token expired and no refresh token is available — reconnect Ramp"
        );
      }
      const data = await this.oauthTokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      });
      this.oauthAccessToken = data.access_token;
      this.oauthExpiresAt = now + (data.expires_in ?? 0) * 1000;
      // Ramp does not rotate refresh tokens — persist the new access token +
      // expiry only; the stored refresh token stays valid.
      await this.options.onTokensRefreshed?.({
        accessToken: this.oauthAccessToken,
        expiresAt: new Date(this.oauthExpiresAt).toISOString()
      });
      return this.oauthAccessToken;
    }

    const now = Date.now();
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      this.tokenExpiresAt - now > TOKEN_REFRESH_MARGIN_MS
    ) {
      return this.accessToken;
    }

    const { clientId, clientSecret } = this.credentials;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(`${this.host}/developer/v1/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: RAMP_SCOPES.join(" ")
      })
    });

    if (response.status === 429) {
      throw new RampRateLimitError(parseRetryAfter(response));
    }
    if (!response.ok) {
      await throwRampApiError(response);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + (data.expires_in ?? 0) * 1000;
    return this.accessToken;
  }

  /**
   * Authenticated JSON request. Throws `RampRateLimitError` on 429 (carrying
   * `Retry-After`) and `RampApiError(status, code, message)` on any other
   * non-2xx (parsed from `error_v2`). There are no in-client retries — retries
   * live at the job layer.
   */
  async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {}
  ): Promise<T> {
    const token = await this.getAccessToken();
    const search = toSearchParams(opts.searchParams);
    const query = search.toString();
    const url = `${this.host}${path}${query ? `?${query}` : ""}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    const response = await fetch(url, init);

    if (response.status === 429) {
      throw new RampRateLimitError(parseRetryAfter(response));
    }
    if (!response.ok) {
      await throwRampApiError(response);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /**
   * Drain a cursor-paginated Ramp list endpoint, following `page.next` until
   * null and parsing each row with `schema`. `page_size=100` on the first page;
   * subsequent pages reuse the query the `page.next` URL carries.
   */
  async *listPaginated<TSchema extends z.ZodTypeAny>(
    path: string,
    params: SearchParamsInit | undefined,
    schema: TSchema
  ): AsyncGenerator<Array<z.infer<TSchema>>> {
    let search = toSearchParams(params);
    if (!search.has("page_size")) {
      search.set("page_size", String(RAMP_PAGE_SIZE));
    }

    while (true) {
      const page = await this.request<{
        data?: unknown[];
        page?: { next?: string | null };
      }>("GET", path, { searchParams: search });

      const rows = (page.data ?? []).map(
        (row) => schema.parse(row) as z.infer<TSchema>
      );
      yield rows;

      const next = page.page?.next;
      if (!next) break;
      search = new URLSearchParams(new URL(next).search);
    }
  }

  // =================================================================
  // Inbound listings (cursor-paginated)
  // =================================================================

  listTransactions(params?: SearchParamsInit) {
    return this.listPaginated(
      "/developer/v1/transactions",
      params,
      RampTransactionSchema
    );
  }

  listBills(params?: SearchParamsInit) {
    return this.listPaginated("/developer/v1/bills", params, RampBillSchema);
  }

  listTransfers(params?: SearchParamsInit) {
    return this.listPaginated(
      "/developer/v1/transfers",
      params,
      RampTransferSchema
    );
  }

  listCashbacks(params?: SearchParamsInit) {
    return this.listPaginated(
      "/developer/v1/cashbacks",
      params,
      RampCashbackSchema
    );
  }

  listReimbursements(params?: SearchParamsInit) {
    return this.listPaginated(
      "/developer/v1/reimbursements",
      params,
      RampReimbursementSchema
    );
  }

  listRepayments(params?: SearchParamsInit) {
    return this.listPaginated(
      "/developer/v1/repayments",
      params,
      RampRepaymentSchema
    );
  }

  listVendors(params?: SearchParamsInit) {
    return this.listPaginated(
      "/developer/v1/vendors",
      params,
      RampVendorSchema
    );
  }

  // =================================================================
  // Single reads / writes (thin, typed)
  // =================================================================

  getReceipt<T = unknown>(id: string): Promise<T> {
    return this.request<T>("GET", `/developer/v1/receipts/${id}`);
  }

  getBusiness<T = unknown>(): Promise<T> {
    return this.request<T>("GET", "/developer/v1/business");
  }

  // ---- Accounting connection ----

  createAccountingConnection<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/accounting/connection", {
      body
    });
  }

  // TODO(task-1): confirm the all-connections path (`/accounting/all-connections`).
  getAccountingConnections<T = unknown>(): Promise<T> {
    return this.request<T>("GET", "/developer/v1/accounting/all-connections");
  }

  deleteAccountingConnection<T = unknown>(): Promise<T> {
    return this.request<T>("DELETE", "/developer/v1/accounting/connection");
  }

  // ---- Accounting master data push ----

  // TODO(task-1): confirm the accounts body key (`gl_accounts`) + path.
  postAccountingAccounts<T = unknown>(batch: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/accounting/accounts", {
      body: batch
    });
  }

  /**
   * List the GL accounts already uploaded to Ramp (paginated). Each row carries
   * `id` (the Carbon `account.id` we pushed, echoed back) and `ramp_id` (Ramp's
   * internal UUID). The PATCH endpoint keys on `ramp_id`, so callers resolve it
   * here before updating.
   */
  listAccountingAccounts() {
    return this.listPaginated(
      "/developer/v1/accounting/accounts",
      undefined,
      z
        .object({
          id: z.string().nullish(),
          ramp_id: z.string().nullish()
        })
        .passthrough()
    );
  }

  patchAccountingAccount<T = unknown>(id: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", `/developer/v1/accounting/accounts/${id}`, {
      body
    });
  }

  postAccountingFields<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/accounting/fields", { body });
  }

  postAccountingFieldOptions<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/accounting/field-options", {
      body
    });
  }

  patchAccountingFieldOption<T = unknown>(
    id: string,
    body: unknown
  ): Promise<T> {
    return this.request<T>(
      "PATCH",
      `/developer/v1/accounting/field-options/${id}`,
      { body }
    );
  }

  // ---- Sync confirmation ----

  postAccountingSyncs<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/accounting/syncs", { body });
  }

  postReadyToSync<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/accounting/ready-to-sync", {
      body
    });
  }

  // ---- Vendors (spend vendors — the id a PO/bill `vendor_id` references) ----

  /**
   * Create a Ramp SPEND vendor (`POST /developer/v1/vendors`). This is the
   * vendor a purchase order / bill `vendor_id` points at — NOT the accounting
   * vendor (`/accounting/vendors`, for coding), whose id a PO/bill rejects.
   * Requires `country` + `business_vendor_contacts: [{ email }]`.
   */
  createSpendVendor<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/vendors", { body });
  }

  // ---- Business entities (for the required PO `entity_id`) ----

  getEntities<T = unknown>(): Promise<T> {
    return this.request<T>("GET", "/developer/v1/entities");
  }

  // ---- Purchase orders ----

  createPurchaseOrder<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/purchase-orders", { body });
  }

  patchPurchaseOrder<T = unknown>(id: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", `/developer/v1/purchase-orders/${id}`, {
      body
    });
  }

  archivePurchaseOrder<T = unknown>(id: string): Promise<T> {
    return this.request<T>(
      "POST",
      `/developer/v1/purchase-orders/${id}/archive`
    );
  }

  // ---- Bills (draft push) ----

  createDraftBill<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/bills/drafts", { body });
  }

  submitDraftBill<T = unknown>(id: string): Promise<T> {
    return this.request<T>("POST", `/developer/v1/bills/drafts/${id}/submit`);
  }

  /**
   * Retract a pushed bill on Carbon-side settlement. Ramp bills have NO
   * `/archive` endpoint (only purchase orders do) — `POST /bills/{id}/archive`
   * 404s. Bills are retracted with `DELETE /bills/{id}`; callers treat this as
   * best-effort (a bill already approved/paid in Ramp may refuse deletion).
   */
  archiveBill<T = unknown>(id: string): Promise<T> {
    return this.request<T>("DELETE", `/developer/v1/bills/${id}`);
  }

  // ---- Webhooks ----

  createWebhook<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/webhooks", { body });
  }

  deleteWebhook<T = unknown>(id: string): Promise<T> {
    return this.request<T>("DELETE", `/developer/v1/webhooks/${id}`);
  }

  // TODO(task-1): confirm the webhook challenge-verify path/shape.
  verifyWebhook<T = unknown>(id: string, challenge: string): Promise<T> {
    return this.request<T>("POST", `/developer/v1/webhooks/${id}/verify`, {
      body: { challenge }
    });
  }
}

// /********************************************************\
// *                      Helpers                           *
// \********************************************************/

function parseRetryAfter(response: Response): number {
  const header = response.headers.get("Retry-After");
  const seconds = header ? Number.parseInt(header, 10) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

async function throwRampApiError(response: Response): Promise<never> {
  let code: string | undefined;
  let message = response.statusText;
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text) as {
        error_v2?: { message?: string; error_code?: string; code?: string };
        message?: string;
      };
      const errorV2 = parsed.error_v2;
      if (errorV2) {
        code = errorV2.error_code ?? errorV2.code;
        message = errorV2.message ?? message;
      } else if (parsed.message) {
        message = parsed.message;
      }
    }
  } catch {
    // Non-JSON body — keep the status text.
  }
  throw new RampApiError(response.status, code, message);
}

/**
 * Deterministic idempotency key for a Ramp write: sha256 of
 * `companyId:operation:scope`. `scope` identifies the logical unit (e.g. a
 * hash of the sorted ids being confirmed) so a retried confirm cannot
 * double-apply. Clone of `buildRilletIdempotencyKey`.
 */
export function buildRampIdempotencyKey(args: {
  companyId: string;
  operation: string;
  scope: string;
}): string {
  return createHash("sha256")
    .update(`${args.companyId}:${args.operation}:${args.scope}`)
    .digest("hex");
}
