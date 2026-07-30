import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { MutableRefObject } from "react";
import type { StoreApi } from "zustand";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../../config/env";

const PER_ATTEMPT_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;
const BACKOFF_MS = [500, 1000];
const RETRYABLE_STATUS = new Set([500, 502, 503, 504, 512, 408, 524]);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Storage object writes (uploads) must NOT go through the retry/timeout wrapper:
// re-sending a multi-GB PUT on a 5xx is wasteful, and the 25s per-attempt timeout
// would abort any legitimately long upload. Fail fast — pass straight through and
// honor only the caller's own signal.
const isStorageUpload = (input: RequestInfo | URL, init?: RequestInit) => {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  if (method !== "POST" && method !== "PUT") return false;
  const url = input instanceof Request ? input.url : String(input);
  return url.includes("/storage/v1/object/");
};

const fetchWithRetry: typeof fetch = async (input, init) => {
  if (isStorageUpload(input, init)) return fetch(input, init);

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const timeoutSignal = AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await fetch(input, { ...init, signal });
      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt] ?? 1000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (init?.signal?.aborted) throw error;
      if (attempt >= MAX_RETRIES) throw error;
      await sleep(BACKOFF_MS[attempt] ?? 1000);
    }
  }
  throw lastError;
};

export const getCarbonClient = (
  supabaseKey: string,
  accessToken?: string
): SupabaseClient<Database, "public"> => {
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : undefined;

  const client = createClient<Database, "public">(SUPABASE_URL!, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      fetch: fetchWithRetry,
      ...(headers ? { headers } : {})
    }
  });

  return client;
};

export const getCarbonAPIKeyClient = (
  apiKey: string
): SupabaseClient<Database, "public"> => {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: {
      fetch: fetchWithRetry,
      headers: {
        "carbon-key": apiKey
      }
    }
  });

  return client;
};

export const createCarbonWithAuthGetter = (
  store: MutableRefObject<StoreApi<{ accessToken: string }>>
): SupabaseClient<Database, "public"> => {
  return createClient<Database, "public">(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      fetch: fetchWithRetry
    },
    async accessToken() {
      if (!store.current) return null;
      const state = store.current.getState();
      return state.accessToken;
    }
  });
};

export const getCarbon = (
  accessToken?: string
): SupabaseClient<Database, "public"> => {
  return getCarbonClient(SUPABASE_ANON_KEY!, accessToken);
};

export const carbonClient = getCarbon();
