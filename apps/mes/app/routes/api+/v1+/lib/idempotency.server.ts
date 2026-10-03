// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import { ApiError } from "@carbon/auth/api-user.server";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";

const log = getLogger("mes-api");

/**
 * Duplicate protection for every authenticated POST.
 *
 * The app retries automatically on a dropped Wi-Fi connection, and most MES
 * commands are NOT idempotent — they insert a productionQuantity, invoke
 * `issue`, post costs. `.ai/lessons.md` ("Retrying a 5xx from a non-idempotent
 * Edge Function multiplies its side effects") is the shape this prevents: one
 * incoming request, several committed results.
 *
 * The rule that makes it safe is that a STORED 5xx is replayed as a 5xx. A
 * command whose first run may have partly applied is never re-run by a retry;
 * only the operator's explicit Retry mints a new key.
 */

const IN_PROGRESS_TTL_SECONDS = 300; // a command the server is still running
const COMPLETED_TTL_SECONDS = 86_400; // 24h, the window a retry may replay in

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const REPLAYED_HEADER = "idempotent-replayed";

type StoredResponse = {
  state: "done";
  fp: string;
  status: number;
  contentType: string;
  body: string;
};
type InProgress = { state: "in_progress"; fp: string };
type Stored = StoredResponse | InProgress;

/** Method + path + body, so the same key cannot be reused for a different call. */
export function fingerprint(method: string, path: string, body: string) {
  return createHash("sha256")
    .update(`${method} ${path}\n${body}`)
    .digest("hex");
}

export function idempotencyCacheKey(
  companyId: string,
  sessionUserId: string,
  key: string
) {
  return `@carbon/mes-api:idem:${companyId}:${sessionUserId}:${key}`;
}

/** A Redis that is not ready cannot de-duplicate, so nothing may run. */
function assertRedisReady() {
  const status = (redis as unknown as { status?: string }).status;
  if (status && status !== "ready" && status !== "connecting") {
    throw new ApiError(
      503,
      "retry_later",
      "Temporarily unavailable, the app will retry"
    );
  }
}

async function readStored(key: string): Promise<Stored | null | "unavailable"> {
  try {
    const raw = await redis.get(key);
    if (raw === null) return "unavailable";
    return JSON.parse(raw) as Stored;
  } catch (e) {
    log.error("Idempotency read failed", { error: e });
    return "unavailable";
  }
}

export async function withIdempotency(
  args: {
    companyId: string;
    sessionUserId: string;
    key: string;
    method: string;
    path: string;
    body: string;
  },
  run: () => Promise<Response>
): Promise<Response> {
  assertRedisReady();

  const cacheKey = idempotencyCacheKey(
    args.companyId,
    args.sessionUserId,
    args.key
  );
  const fp = fingerprint(args.method, args.path, args.body);

  let claimed: string | null = null;
  try {
    claimed = await redis.set(
      cacheKey,
      JSON.stringify({ state: "in_progress", fp } satisfies InProgress),
      "EX",
      IN_PROGRESS_TTL_SECONDS,
      "NX"
    );
  } catch (e) {
    log.error("Idempotency claim failed", { error: e });
  }

  if (claimed !== "OK") {
    // `null` from @carbon/kv means EITHER "the key exists" OR "Redis is down"
    // (it fails soft). Reading it back tells the two apart: a down Redis
    // answers null again, and then nothing may run.
    const stored = await readStored(cacheKey);

    if (stored === "unavailable" || stored === null) {
      throw new ApiError(
        503,
        "retry_later",
        "Temporarily unavailable, the app will retry"
      );
    }

    if (stored.state === "in_progress") {
      throw new ApiError(
        409,
        "request_in_progress",
        "Still working on that — the app will retry"
      );
    }

    if (stored.fp !== fp) {
      throw new ApiError(
        422,
        "idempotency_key_reused",
        "This request id was already used for a different action"
      );
    }

    return new Response(stored.body, {
      status: stored.status,
      headers: {
        "Content-Type": stored.contentType,
        [REPLAYED_HEADER]: "true"
      }
    });
  }

  const response = await run();

  // Store the outcome — INCLUDING a 5xx. See the note at the top of the file.
  const body = await response.clone().text();
  try {
    await redis.set(
      cacheKey,
      JSON.stringify({
        state: "done",
        fp,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "application/json",
        body
      } satisfies StoredResponse),
      "EX",
      COMPLETED_TTL_SECONDS
    );
  } catch (e) {
    // The command already ran; failing the response now would be worse than
    // losing the de-duplication window.
    log.error("Idempotency store failed", { error: e });
  }

  return response;
}
