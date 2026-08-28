import { createHash } from "node:crypto";
import type { z } from "zod";
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

export class RampClient {
  private readonly host: string;
  private accessToken?: string;
  /** Epoch ms at which the cached token expires. */
  private tokenExpiresAt?: number;

  constructor(private readonly credentials: RampCredentials) {
    this.host =
      credentials.environment === "sandbox"
        ? RAMP_SANDBOX_HOST
        : RAMP_PRODUCTION_HOST;
  }

  /**
   * Return a valid bearer token, minting/caching one for client-credentials and
   * re-minting when fewer than 60s remain. OAuth2 returns the stored token
   * (refresh is a later phase — an expired oauth2 token throws).
   */
  private async getAccessToken(): Promise<string> {
    if (this.credentials.type === "oauth2") {
      const { accessToken, expiresAt } = this.credentials;
      if (expiresAt && Date.parse(expiresAt) - Date.now() < 0) {
        throw new Error(
          "OAuth refresh not implemented — use client_credentials"
        );
      }
      return accessToken;
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

  // ---- Vendors (accounting vendor upload) ----

  createVendor<T = unknown>(body: unknown): Promise<T> {
    return this.request<T>("POST", "/developer/v1/accounting/vendors", {
      body
    });
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
