import type { Avalara } from "./types";

/**
 * Shared HTTP core for the Avalara integration: authentication, base-URL
 * selection, retry policy, timeouts, and a single error taxonomy shared by the
 * AvaTax and e-invoicing surfaces.
 *
 * Constructed only in server code (`service.server.ts`, hooks, API routes).
 * `config.tsx` must never import this file — it is bundled for the browser.
 */

const CLIENT_VERSION = "1.0";
/** Required by AvaTax: `Carbon; {version}; REST; v2; {machine}`. */
const X_AVALARA_CLIENT = `Carbon; ${CLIENT_VERSION}; REST; v2; carbon`;
/** Header value for the e-invoicing API. */
const EINVOICING_VERSION = "1.4";

const AVATAX_BASE: Record<Avalara.Environment, string> = {
  sandbox: "https://sandbox-rest.avatax.com",
  production: "https://rest.avatax.com"
};

const EINVOICING_BASE: Record<Avalara.Environment, string> = {
  sandbox: "https://api.sbx.avalara.com/einvoicing",
  production: "https://api.avalara.com/einvoicing"
};

/** Avalara Identity OAuth2 token endpoints (client-credentials). */
const IDENTITY_TOKEN_URL: Record<Avalara.Environment, string> = {
  sandbox: "https://identity.sandbox.avalara.com/connect/token",
  production: "https://identity.avalara.com/connect/token"
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 300;

export type AvalaraErrorKind =
  | "auth"
  | "validation"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "transient"
  | "not_configured";

export class AvalaraError extends Error {
  readonly kind: AvalaraErrorKind;
  readonly status?: number;
  readonly avalaraCode?: string;
  readonly retryable: boolean;
  readonly details?: Avalara.ErrorDetail[];

  constructor(args: {
    kind: AvalaraErrorKind;
    message: string;
    status?: number;
    avalaraCode?: string;
    retryable?: boolean;
    details?: Avalara.ErrorDetail[];
  }) {
    super(args.message);
    this.name = "AvalaraError";
    this.kind = args.kind;
    this.status = args.status;
    this.avalaraCode = args.avalaraCode;
    this.retryable = args.retryable ?? false;
    this.details = args.details;
  }
}

/**
 * Map an HTTP status + AvaTax error body onto the error taxonomy. The license
 * key is never included — only the taxonomy `kind` and Avalara's own message.
 */
export function toAvalaraError(
  status: number,
  body: Avalara.ErrorBody | undefined
): AvalaraError {
  const err = body?.error;
  const avalaraCode = err?.code;
  const details = err?.details;
  const message = err?.message ?? err?.details?.[0]?.message;

  if (status === 401 || status === 403) {
    return new AvalaraError({
      kind: "auth",
      message: message ?? "Avalara authentication failed",
      status,
      avalaraCode,
      details,
      retryable: false
    });
  }

  if (status === 404) {
    return new AvalaraError({
      kind: "not_found",
      message: message ?? "Avalara resource not found",
      status,
      avalaraCode,
      details,
      retryable: false
    });
  }

  if (status === 409) {
    return new AvalaraError({
      kind: "conflict",
      message: message ?? "Avalara conflict",
      status,
      avalaraCode,
      details,
      retryable: false
    });
  }

  if (status === 429) {
    return new AvalaraError({
      kind: "rate_limit",
      message: message ?? "Avalara rate limit exceeded",
      status,
      avalaraCode,
      details,
      retryable: true
    });
  }

  if (status >= 500) {
    return new AvalaraError({
      kind: "transient",
      message: message ?? "Avalara service error",
      status,
      avalaraCode,
      details,
      retryable: true
    });
  }

  // Any other 4xx (400, 422, ...) is a non-retryable validation error.
  return new AvalaraError({
    kind: "validation",
    message: message ?? "Avalara request was rejected",
    status,
    avalaraCode,
    details,
    retryable: false
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AvalaraHttpOptions = {
  environment: Avalara.Environment;
  accountId: string;
  licenseKey: string;
  /** Avalara Identity OAuth2 client id (e-invoicing surface only). */
  clientId?: string;
  /** Avalara Identity OAuth2 client secret (e-invoicing surface only). */
  clientSecret?: string;
  /** Injectable for tests — defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests — defaults to real `setTimeout`. */
  sleepImpl?: (ms: number) => Promise<unknown>;
};

type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /**
   * Whether this call may be retried on a retryable error. Defaults to `true`
   * for GET and `false` for mutating verbs. A committed transaction must never
   * be auto-retried after an ambiguous timeout unless it carries an idempotent
   * `code` — callers opt in explicitly.
   */
  retryable?: boolean;
};

type CachedToken = { token: string; expiresAt: number };

/**
 * The HTTP core. Returns `{ data, error }` and never throws past the taxonomy.
 */
export class AvalaraHttp {
  private readonly environment: Avalara.Environment;
  private readonly accountId: string;
  private readonly licenseKey: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<unknown>;
  private tokenCache: CachedToken | null = null;

  constructor(options: AvalaraHttpOptions) {
    this.environment = options.environment;
    this.accountId = options.accountId;
    this.licenseKey = options.licenseKey;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? sleep;
  }

  private baseUrl(surface: Avalara.Surface): string {
    return surface === "avatax"
      ? AVATAX_BASE[this.environment]
      : EINVOICING_BASE[this.environment];
  }

  private buildUrl(
    surface: Avalara.Surface,
    path: string,
    query?: RequestOptions["query"]
  ): string {
    const url = new URL(`${this.baseUrl(surface)}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private basicAuthHeader(): string {
    const token = Buffer.from(`${this.accountId}:${this.licenseKey}`).toString(
      "base64"
    );
    return `Basic ${token}`;
  }

  /**
   * Fetch (and cache) an Avalara Identity bearer token via the OAuth2
   * client-credentials grant. Used only by the e-invoicing surface.
   */
  private async getBearerToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new AvalaraError({
        kind: "not_configured",
        message:
          "Avalara e-invoicing is not configured (missing AVALARA_CLIENT_ID / AVALARA_CLIENT_SECRET)"
      });
    }

    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 30_000) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: "avatax_api"
    });

    let response: Response;
    try {
      response = await this.fetchImpl(IDENTITY_TOKEN_URL[this.environment], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      });
    } catch {
      throw new AvalaraError({
        kind: "transient",
        message: "Avalara Identity token endpoint unreachable",
        retryable: true
      });
    }

    if (!response.ok) {
      throw new AvalaraError({
        kind: response.status === 401 ? "auth" : "transient",
        message: "Failed to obtain Avalara Identity token",
        status: response.status,
        retryable: response.status >= 500
      });
    }

    const json = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    this.tokenCache = {
      token: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000
    };
    return json.access_token;
  }

  private async authHeaders(surface: Avalara.Surface): Promise<HeadersInit> {
    if (surface === "avatax") {
      return {
        Authorization: this.basicAuthHeader(),
        "X-Avalara-Client": X_AVALARA_CLIENT
      };
    }
    const token = await this.getBearerToken();
    return {
      Authorization: `Bearer ${token}`,
      "avalara-version": EINVOICING_VERSION
    };
  }

  async request<T>(
    surface: Avalara.Surface,
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<{ data: T | null; error: AvalaraError | null }> {
    const isGet = method.toUpperCase() === "GET";
    const retryable = options.retryable ?? isGet;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const url = this.buildUrl(surface, path, options.query);

    let lastError: AvalaraError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Auth header retrieval lives inside the retry loop so a transient
      // token-fetch failure (e.g. Identity endpoint unreachable) gets the same
      // backoff treatment as the request itself.
      let headers: HeadersInit;
      try {
        headers = await this.authHeaders(surface);
      } catch (err) {
        lastError =
          err instanceof AvalaraError
            ? err
            : new AvalaraError({ kind: "auth", message: "Avalara auth error" });
        if (retryable && lastError.retryable && attempt < MAX_RETRIES) {
          await this.sleepImpl(this.backoff(attempt));
          continue;
        }
        return { data: null, error: lastError };
      }

      const init: RequestInit = {
        method,
        headers: {
          Accept: "application/json",
          ...headers,
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {})
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {})
      };

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (err) {
        // Network failure or timeout abort — transient.
        lastError = new AvalaraError({
          kind: "transient",
          message:
            (err as Error)?.name === "TimeoutError" ||
            (err as Error)?.name === "AbortError"
              ? "Avalara request timed out"
              : "Avalara request failed",
          retryable: true
        });
        if (retryable && attempt < MAX_RETRIES) {
          await this.sleepImpl(this.backoff(attempt));
          continue;
        }
        return { data: null, error: lastError };
      }

      if (response.ok) {
        const data = (await this.parseJson(response)) as T;
        return { data, error: null };
      }

      const body = (await this.parseJson(response)) as
        | Avalara.ErrorBody
        | undefined;
      const error = toAvalaraError(response.status, body);
      lastError = error;

      if (retryable && error.retryable && attempt < MAX_RETRIES) {
        const retryAfter = this.retryAfterMs(response);
        await this.sleepImpl(retryAfter ?? this.backoff(attempt));
        continue;
      }

      return { data: null, error };
    }

    return { data: null, error: lastError };
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private retryAfterMs(response: Response): number | null {
    const header = response.headers.get("Retry-After");
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    return null;
  }

  private backoff(attempt: number): number {
    const exp = BASE_BACKOFF_MS * 2 ** attempt;
    const jitter = Math.random() * BASE_BACKOFF_MS;
    return exp + jitter;
  }
}
