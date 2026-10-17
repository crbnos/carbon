// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ServerFnError } from "@carbon/api/errors";
import type { MES_POSTINGS, MesPostingName } from "@carbon/api/postings";
import type {
  PostingContract,
  PostingOutcome
} from "@carbon/api/postings.server";
import { SESSION_SECRET, SUPABASE_SERVICE_ROLE_KEY } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ERP_URL } from "~/utils/path";

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

/** Runs a posting in the ERP. Never throws: `{ data, error }`. */
export async function erpPosting<K extends MesPostingName>(
  name: K,
  caller: Caller,
  input: ErpPostingInput<K>
): Promise<PostingOutcome<PostingContract[K]["output"]>> {
  try {
    const { signInternalCall } = await import("@carbon/api/internal-call");
    const authorization = callerAuthorization(
      caller.client,
      SUPABASE_SERVICE_ROLE_KEY
    );
    const body = JSON.stringify(input);
    const response = await fetch(`${ERP_URL}/api/internal/postings/${name}`, {
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
    });
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
