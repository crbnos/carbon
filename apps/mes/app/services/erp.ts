// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ServerFnError } from "@carbon/api/errors";
import type { MES_POSTINGS, MesPostingName } from "@carbon/api/postings";
import type {
  PostingContract,
  PostingOutcome
} from "@carbon/api/postings.server";
import {
  CarbonEdition,
  CONTROLLED_ENVIRONMENT,
  getEnv,
  IS_LOCAL_DEV,
  SESSION_SECRET,
  SUPABASE_SERVICE_ROLE_KEY,
  VERCEL_ENV
} from "@carbon/auth";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { Edition } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only. Client components import the services that call this, so the
// signer (node:crypto) loads on first use; the secrets read "" in a browser.

const log = getLogger("mes", "erp");

/** A posting's input, narrowed to the `type` values the ERP accepts from MES:
 *  a new one fails typecheck here instead of the ERP refusing it. */
export type ErpPostingInput<K extends MesPostingName> =
  (typeof MES_POSTINGS)[K] extends readonly (infer T)[]
    ? PostingContract[K]["input"] & { type: T }
    : PostingContract[K]["input"];

type Caller = {
  companyId: string;
  /** Recorded on every write the posting makes. */
  userId: string;
  /**
   * The signed-in user's client: the posting checks that user's permission
   * first. Without it (or with the service role) it runs as the system.
   */
  client?: SupabaseClient<Database>;
};

/**
 * The ERP that MES posts to: `ERP_URL`, the ERP's own address. Carbon Cloud's
 * production MES leaves it unset and posts to Carbon Cloud's ERP, as the old
 * `getAppUrl()` default did. Nothing else is safe to guess: a preview's
 * `APP_URL` is MES itself, and a self-hosted MES would send its users' tokens
 * to Carbon Cloud.
 */
export function erpPostingUrl(
  erpUrl = getEnv("ERP_URL"),
  where: "local" | "cloud" | "other" = IS_LOCAL_DEV
    ? "local"
    : CarbonEdition === Edition.Cloud && VERCEL_ENV !== "preview"
      ? "cloud"
      : "other"
): string {
  if (erpUrl) return erpUrl;
  if (where === "local") return "http://localhost:3000";
  if (where === "cloud") {
    return CONTROLLED_ENVIRONMENT
      ? "https://itar.carbon.ms"
      : "https://app.carbon.ms";
  }
  throw new Error("ERP_URL is not set: MES does not know where the ERP is");
}

/** Runs a posting in the ERP. Never throws: `{ data, error }`. */
export async function erpPosting<K extends MesPostingName>(
  name: K,
  caller: Caller,
  input: ErpPostingInput<K>
): Promise<PostingOutcome<PostingContract[K]["output"]>> {
  // A throw here is this deployment's set-up (ERP_URL, SESSION_SECRET, a
  // client with no signed-in user), not the network: retrying will not help.
  let url: string;
  let init: RequestInit;
  try {
    const { signInternalCall } = await import("@carbon/api/internal-call");
    const authorization = callerAuthorization(
      caller.client,
      SUPABASE_SERVICE_ROLE_KEY
    );
    const body = JSON.stringify(input);
    url = `${erpPostingUrl()}/api/internal/postings/${name}`;
    init = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signInternalCall(
          SESSION_SECRET ?? "",
          {
            name,
            companyId: caller.companyId,
            userId: caller.userId,
            mode: authorization ? "caller" : "system"
          },
          body,
          authorization
        )
      },
      body
    };
  } catch (cause) {
    log.error("ERP posting is not configured", {
      name,
      companyId: caller.companyId,
      error: cause
    });
    return {
      data: null,
      error: new ServerFnError(
        "MES is not configured to post to the ERP. Ask an administrator to check its configuration.",
        500,
        {},
        { cause }
      )
    };
  }

  try {
    const response = await fetch(url, init);
    const result = (await response.json().catch(() => null)) as {
      data: PostingContract[K]["output"];
      error: {
        status: number;
        message: string;
        body?: Record<string, unknown>;
      } | null;
    } | null;
    if (result?.error) {
      const { message, status, body: details } = result.error;
      return {
        data: null,
        error: new ServerFnError(message, status, details ?? {})
      };
    }
    if (!response.ok || !result) {
      throw new Error(`The ERP answered ${response.status}`);
    }
    return { data: result.data, error: null };
  } catch (cause) {
    log.error("ERP posting failed", {
      name,
      companyId: caller.companyId,
      error: cause
    });
    return {
      data: null,
      error: new ServerFnError("Could not reach the ERP", 502, {}, { cause })
    };
  }
}

/** The caller's `Bearer` header, or "" when the client is the service role. */
function callerAuthorization(
  client: SupabaseClient<Database> | undefined,
  serviceRoleKey: string | undefined
): string {
  if (!client) return "";
  const { supabaseKey, headers } = client as unknown as {
    supabaseKey?: string;
    headers?: Record<string, string>;
  };
  if (serviceRoleKey && supabaseKey === serviceRoleKey) return "";
  const authorization = headers?.Authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("The client carries no signed-in user");
  }
  return authorization;
}
