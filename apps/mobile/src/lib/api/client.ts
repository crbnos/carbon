// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { API_PREFIX, HEADERS } from "@carbon/mes-core";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import type { z } from "zod";
import { ApiClientError, mapErrorResponse, networkError } from "./errors";

/** 15s: a shop-floor Wi-Fi drop must surface as a retry, not a frozen button. */
const TIMEOUT_MS = 15_000;

export type ApiRequestInit<T> = {
  method?: "GET" | "POST";
  body?: unknown;
  /** Validated with the SHARED contract, so a bad payload fails loudly. */
  schema?: z.ZodType<T>;
  /** Reuse a key to make the server de-duplicate a retry of the same command. */
  idempotencyKey?: string;
  /** `auth/*` calls, which carry no session yet. */
  isPublic?: boolean;
  signal?: AbortSignal;
  /**
   * Name the company for THIS call instead of the scope's.
   *
   * One caller: switching company. `/me` answers for the company in the
   * header, and the scope still names the company being left until the
   * switch has finished — so the call that learns about the new company has
   * to name it itself. `null` sends no company at all, which only `/me`
   * accepts.
   */
  companyId?: string | null;
};

export type ApiScope = {
  serverUrl: string;
  companyId?: string;
  locationId?: string;
  /** Shared tablets: the in-memory operator token. */
  operatorToken?: string;
  terminalToken?: string;
};

export type ApiClientOptions = {
  scope: () => ApiScope;
  /** The current access token, or null before sign-in. */
  getAccessToken: () => string | null;
  /** Refresh once on `token_expired`, then the call is retried a single time. */
  refreshSession?: () => Promise<string | null>;
  /** Every response may carry a refreshed operator token. */
  onOperatorToken?: (token: string) => void;
};

export function newIdempotencyKey() {
  return randomUUID();
}

export function createApiClient(options: ApiClientOptions) {
  const appVersion = Constants.expoConfig?.version ?? "0.0.0";

  async function send<T>(
    path: string,
    init: ApiRequestInit<T>,
    isRetry: boolean
  ): Promise<T> {
    const scope = options.scope();
    const url = `${scope.serverUrl}${API_PREFIX}${path}`;
    const method = init.method ?? "GET";

    const headers: Record<string, string> = {
      accept: "application/json",
      [HEADERS.appVersion]: appVersion
    };
    if (init.body !== undefined) headers["content-type"] = "application/json";

    if (!init.isPublic) {
      const token = options.getAccessToken();
      if (!token)
        throw new ApiClientError(401, "invalid_token", "Sign in to continue");
      headers.authorization = `Bearer ${token}`;
      const companyId =
        init.companyId === undefined ? scope.companyId : init.companyId;
      if (companyId) headers[HEADERS.company] = companyId;
      // A location belongs to the scope's company; sending it alongside an
      // overridden company would pair one tenant's location with another's id.
      if (scope.locationId && init.companyId === undefined) {
        headers[HEADERS.location] = scope.locationId;
      }
      if (scope.operatorToken) {
        headers[HEADERS.operator] = scope.operatorToken;
      }
      if (scope.terminalToken) {
        headers[HEADERS.terminal] = scope.terminalToken;
      }
      if (method === "POST") {
        headers[HEADERS.idempotencyKey] =
          init.idempotencyKey ?? newIdempotencyKey();
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const abort = () => controller.abort();
    init.signal?.addEventListener("abort", abort);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal
      });
    } catch {
      // Indistinguishable from the app's side: offline, DNS, TLS, timeout.
      // All of them mean "may never have arrived", which is retry-safe.
      throw networkError();
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abort);
    }

    const refreshed = response.headers.get(HEADERS.operator);
    if (refreshed) options.onOperatorToken?.(refreshed);

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const err = mapErrorResponse(
        response.status,
        parsed,
        response.headers,
        path
      );
      // One refresh, one retry. A second 401 is a real sign-out.
      if (
        !isRetry &&
        err.status === 401 &&
        err.code === "token_expired" &&
        options.refreshSession
      ) {
        const token = await options.refreshSession();
        if (token) return send<T>(path, init, true);
      }
      throw err;
    }

    if (!init.schema) return parsed as T;

    const result = init.schema.safeParse(parsed);
    if (!result.success) {
      // The server sent a shape this app build cannot read. Say so plainly
      // rather than crashing a screen on a missing field.
      throw new ApiClientError(
        response.status,
        "server_too_old",
        "This Carbon server sent something the app could not read",
        undefined,
        result.error.flatten()
      );
    }
    return result.data;
  }

  return {
    request<T>(path: string, init: ApiRequestInit<T> = {}) {
      return send<T>(path, init, false);
    }
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
