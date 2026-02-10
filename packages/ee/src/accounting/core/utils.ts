import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import type {
  AuthProvider,
  OAuthClientOptions,
  ProviderCredentials
} from "./types";

/**
 * Execute a database operation with sync triggers disabled.
 * This prevents circular trigger loops when syncing from external systems.
 *
 * Uses PostgreSQL session variable `app.sync_in_progress` which is checked
 * by the `dispatch_event_batch` trigger function.
 *
 * @param db - The Kysely database instance
 * @param operation - A callback that receives the transaction and performs DB operations
 */
export async function withTriggersDisabled<T>(
  db: Kysely<KyselyDatabase>,
  operation: (tx: KyselyTx) => Promise<T>
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    // Set the session variable to disable event triggers for this transaction
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(tx);
    return await operation(tx);
  });
}

export class HTTPClient {
  constructor(private baseUrl?: string) {}

  async request<T>(method: string, path: string, opts: RequestInit = {}) {
    let response!: Response;

    try {
      response = await this.fetch(method, path, opts);

      if (response.status === 429) {
        const rateLimitInfo = parseRateLimitInfo(response);
        throw new RatelimitError("Rate limit exceeded", rateLimitInfo);
      }

      return this.parseResponse<T>(response);
    } catch (error) {
      if (error instanceof RatelimitError) {
        throw error;
      }

      return this.parseResponse<T>(response);
    }
  }

  private fetch(
    method: string,
    path: string,
    opts: RequestInit
  ): Promise<Response> {
    const url = this.baseUrl ? `${this.baseUrl}${path}` : path;

    return fetch(url, {
      method,
      ...opts
    });
  }

  private async parseResponse<T>(response: Response) {
    const contentType = response.headers.get("content-type");
    const isJson = contentType?.includes("application/json");

    if (!response.ok) {
      const text = await response.text();
      let parsedData: unknown = text;

      // Try to parse JSON error responses for better error details
      if (isJson && text) {
        try {
          parsedData = JSON.parse(text);
        } catch {
          // Keep as raw string if parsing fails
        }
      }

      return {
        error: true,
        message: response.statusText,
        code: response.status,
        data: parsedData
      } as const;
    }

    if (isJson) {
      try {
        const text = await response.text();
        if (!text || text.trim() === "") {
          return {
            error: false,
            message: response.statusText,
            code: response.status,
            data: null
          } as const;
        }
        return {
          error: false,
          message: response.statusText,
          code: response.status,
          data: JSON.parse(text) as T
        } as const;
      } catch {
        return {
          error: true,
          message: "Invalid JSON response",
          code: response.status,
          data: null
        } as const;
      }
    }

    return {
      error: false,
      message: response.statusText,
      code: response.status,
      data: null
    } as const;
  }
}

// /********************************************************\
// *                     Custom Errors Start                *
// \********************************************************/
export class NotImplementedError extends Error {
  constructor(name: string) {
    super(`Method ${name} is not implemented.`);
    this.name = "NotImplementedError";
  }
}

export interface RateLimitInfo {
  /** Seconds to wait before retrying */
  retryAfterSeconds: number;
  /** Which limit was hit (e.g., "minute", "day") */
  limitType?: string;
  /** Provider-specific details */
  details?: Record<string, unknown>;
}

export class RatelimitError extends Error {
  public rateLimitInfo: RateLimitInfo;

  constructor(message: string, rateLimitInfo: RateLimitInfo) {
    super(message);
    this.name = "RatelimitError";
    this.rateLimitInfo = rateLimitInfo;
  }

  get retryAfterSeconds(): number {
    return this.rateLimitInfo.retryAfterSeconds;
  }
}

/**
 * Parse rate limit info from a 429 response.
 * Handles Xero-specific headers but can be extended for other providers.
 */
export function parseRateLimitInfo(response: Response): RateLimitInfo {
  // Parse Retry-After header (standard HTTP header, value in seconds)
  const retryAfter = response.headers.get("Retry-After");
  let retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

  // Fallback to 60 seconds if parsing fails
  if (isNaN(retryAfterSeconds) || retryAfterSeconds <= 0) {
    retryAfterSeconds = 60;
  }

  // Parse provider-specific headers
  const limitType = response.headers.get("X-Rate-Limit-Problem") ?? undefined;

  const details: Record<string, unknown> = {};

  // Xero-specific headers
  const minuteRemaining = response.headers.get("X-MinLimit-Remaining");
  const dayRemaining = response.headers.get("X-DayLimit-Remaining");
  const appMinuteRemaining = response.headers.get("X-AppMinLimit-Remaining");

  if (minuteRemaining) details.minuteRemaining = parseInt(minuteRemaining, 10);
  if (dayRemaining) details.dayRemaining = parseInt(dayRemaining, 10);
  if (appMinuteRemaining)
    details.appMinuteRemaining = parseInt(appMinuteRemaining, 10);

  return {
    retryAfterSeconds,
    limitType,
    details: Object.keys(details).length > 0 ? details : undefined
  };
}

/** Structured details from an accounting provider API error */
export interface ApiErrorDetails {
  /** HTTP status code (e.g., 400, 401, 500) */
  statusCode: number;
  /** HTTP status text (e.g., "Bad Request") */
  statusText: string;
  /** Provider-specific error code if available */
  providerErrorCode?: string | number;
  /** Provider-specific error type (e.g., "ValidationException") */
  providerErrorType?: string;
  /** Human-readable error message from the provider */
  providerMessage?: string;
  /** Validation errors for specific fields/elements */
  validationErrors?: Array<{
    field?: string;
    message: string;
  }>;
  /** Raw response body for debugging (only logged in development) */
  rawResponse?: unknown;
}

/**
 * Structured error class for accounting provider API errors.
 * Captures detailed error information for debugging and user display.
 */
export class AccountingApiError extends Error {
  public readonly details: ApiErrorDetails;
  public readonly provider: string;
  public readonly operation: string;

  constructor(provider: string, operation: string, details: ApiErrorDetails) {
    // Build a human-readable message
    const messages: string[] = [`${details.statusCode} ${details.statusText}`];

    if (details.providerMessage) {
      messages.push(details.providerMessage);
    }

    if (details.validationErrors?.length) {
      messages.push(details.validationErrors.map((e) => e.message).join("; "));
    }

    super(`[${provider}] ${operation} failed: ${messages.join(" - ")}`);

    this.name = "AccountingApiError";
    this.provider = provider;
    this.operation = operation;
    this.details = details;
  }

  /** Get a concise error message suitable for user display */
  getUserMessage(): string {
    if (this.details.validationErrors?.length) {
      return this.details.validationErrors.map((e) => e.message).join("; ");
    }
    return this.details.providerMessage || this.details.statusText;
  }
}
// /********************************************************\
// *                     Custom Errors End                  *
// \********************************************************/

// /********************************************************\
// *              Xero Error Parsing Start                  *
// \********************************************************/

/**
 * Parses Xero API error responses into structured ApiErrorDetails.
 *
 * Xero returns errors in several formats:
 *
 * 1. ValidationException with Elements:
 * {
 *   "ErrorNumber": 10,
 *   "Type": "ValidationException",
 *   "Message": "A validation exception occurred",
 *   "Elements": [{
 *     "ValidationErrors": [{ "Message": "Code must be unique" }]
 *   }]
 * }
 *
 * 2. Simple error:
 * { "Message": "Something went wrong" }
 *
 * 3. OAuth error:
 * { "error": "invalid_grant", "error_description": "Token expired" }
 *
 * 4. RFC 7807 problem+json:
 * { "type": "...", "title": "...", "detail": "..." }
 */
export function extractXeroErrorDetails(
  statusCode: number,
  statusText: string,
  responseData: unknown
): ApiErrorDetails {
  const details: ApiErrorDetails = {
    statusCode,
    statusText,
    rawResponse: responseData
  };

  // Try to parse if it's a string
  let data: unknown = responseData;
  if (typeof responseData === "string") {
    try {
      data = JSON.parse(responseData);
    } catch {
      // Not JSON, use raw string as message if short enough
      if (responseData.length < 500) {
        details.providerMessage = responseData;
      }
      return details;
    }
  }

  if (typeof data !== "object" || data === null) {
    return details;
  }

  const obj = data as Record<string, unknown>;

  // Extract error type and code
  if (typeof obj.Type === "string") {
    details.providerErrorType = obj.Type;
  }
  if (obj.ErrorNumber !== undefined) {
    details.providerErrorCode = obj.ErrorNumber as number;
  }

  // Extract main message (try multiple common formats)
  if (typeof obj.Message === "string") {
    details.providerMessage = obj.Message;
  } else if (typeof obj.message === "string") {
    details.providerMessage = obj.message;
  } else if (typeof obj.detail === "string") {
    // RFC 7807 format
    details.providerMessage = obj.detail;
  } else if (typeof obj.error_description === "string") {
    // OAuth format
    details.providerMessage = obj.error_description;
    details.providerErrorType = obj.error as string;
  }

  // Extract validation errors from Elements array
  if (Array.isArray(obj.Elements)) {
    const validationErrors: Array<{ field?: string; message: string }> = [];

    for (const element of obj.Elements) {
      if (element && Array.isArray(element.ValidationErrors)) {
        for (const err of element.ValidationErrors) {
          if (err && typeof err.Message === "string") {
            validationErrors.push({ message: err.Message });
          }
        }
      }
    }

    if (validationErrors.length > 0) {
      details.validationErrors = validationErrors;
    }
  }

  return details;
}

const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Creates and logs an AccountingApiError from an HTTP response, then throws it.
 * Logs full error details to console for debugging.
 *
 * @param operation - Description of the operation that failed (e.g., "create item", "batch upsert contacts")
 * @param response - The HTTP response object from HTTPClient
 * @throws AccountingApiError
 */
export function throwXeroApiError(
  operation: string,
  response: { error: boolean; message: string; code: number; data: unknown }
): never {
  const details = extractXeroErrorDetails(
    response.code,
    response.message,
    response.data
  );

  const error = new AccountingApiError("xero", operation, details);

  // Log full error details for debugging
  const logDetails: Record<string, unknown> = {
    statusCode: details.statusCode,
    statusText: details.statusText,
    providerErrorType: details.providerErrorType,
    providerErrorCode: details.providerErrorCode,
    providerMessage: details.providerMessage,
    validationErrors: details.validationErrors
  };

  // Only include raw response in development to avoid log bloat
  if (isDevelopment) {
    logDetails.rawResponse = details.rawResponse;
  }

  console.error(`[Xero API Error] ${operation}`, logDetails);

  throw error;
}

// /********************************************************\
// *              Xero Error Parsing End                    *
// \********************************************************/

export function createOAuthClient({
  clientId,
  clientSecret,
  ...options
}: OAuthClientOptions): AuthProvider {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const http = new HTTPClient();

  let creds: ProviderCredentials = {
    type: "oauth2",
    accessToken: options.accessToken!,
    refreshToken: options.refreshToken!
  };

  return {
    getAuthUrl: options.getAuthUrl,
    async exchangeCode(code: string, redirectUri?: string) {
      const response = await http.request<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }>("POST", options.tokenUrl, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri ?? options.redirectUri ?? ""
        })
      });

      if (response.error || !response.data) {
        throw new Error(`Auth failed: ${response.data}`);
      }

      const newCreds = {
        type: "oauth2",
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(
          Date.now() + response.data.expires_in * 1000
        ).toISOString()
      } satisfies ProviderCredentials;

      creds = {
        ...creds,
        ...newCreds
      };

      options.onTokenRefresh && (await options.onTokenRefresh(newCreds));

      return newCreds;
    },
    async refresh() {
      console.log("Refreshing OAuth tokens", creds);
      if (!creds?.refreshToken) {
        throw new Error("No refresh token available");
      }

      const response = await http.request<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }>("POST", options.tokenUrl, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: creds.refreshToken
        })
      });

      if (response.error || !response.data) {
        console.log(response.data);
        throw new Error(`Token refresh failed: ${response.error}`);
      }

      const newCreds = {
        type: "oauth2",
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(
          Date.now() + response.data.expires_in * 1000
        ).toISOString(),
        tenantId: creds?.tenantId
      } satisfies ProviderCredentials;

      creds = {
        ...creds,
        ...newCreds
      };

      options.onTokenRefresh && (await options.onTokenRefresh(newCreds));

      return newCreds;
    },
    getCredentials() {
      if (!creds) {
        throw new Error("No credentials available");
      }

      return creds;
    }
  };
}
