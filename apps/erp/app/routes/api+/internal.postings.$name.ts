// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  INTERNAL_CALL_WINDOW_MS,
  readInternalCallBody,
  readInternalCallHeaders,
  verifyInternalCall
} from "@carbon/api/internal-call";
import { isMesPosting } from "@carbon/api/postings";
import { type PostingHandles, posting } from "@carbon/api/postings.server";
import { getCarbon } from "@carbon/auth";
import { SESSION_SECRET } from "@carbon/env";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";

// The postings MES runs (it cannot import the ERP). MES signs the company, the
// user and the mode (`@carbon/api/internal-call`); the signature is the only
// credential, so no cookie is read. In caller mode the user's token rides
// along and the posting checks that user, as it checks any caller's client.

const logger = getLogger("erp", "internal-postings");

const refuse = (status: number, message: string) =>
  Response.json({ data: null, error: { status, message } }, { status });

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return refuse(405, "Method not allowed");
  const name = params.name ?? "";

  // Checked before the body is read, so a request with no signature never
  // has its body buffered.
  if (!readInternalCallHeaders(name, request.headers)) {
    logger.warn("Refused an internal call with no valid signature", { name });
    return refuse(401, "Unauthorized");
  }
  const body = await readInternalCallBody(request);
  if (body === null) {
    logger.warn("Refused an internal call with a body too large", { name });
    return refuse(413, "The body is too large");
  }

  const call = verifyInternalCall(
    SESSION_SECRET ?? "",
    name,
    request.headers,
    body
  );
  if (!call) {
    logger.warn("Refused an internal call with no valid signature", { name });
    return refuse(401, "Unauthorized");
  }

  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return refuse(400, "The body is not JSON");
  }
  if (!isMesPosting(name, input)) {
    logger.warn("Refused an internal call MES does not make", {
      name,
      companyId: call.companyId
    });
    return refuse(404, `MES does not call ${name} with this input`);
  }

  // `@carbon/kv` answers null both for a nonce already set and when Redis is
  // down or slow, so a null is read back. The value is this request's own:
  // a SET that answered null after its timeout but still landed holds it, and
  // is this call, not a replay. With Redis down the call is accepted: the
  // signature and its window still bound it, and the shop floor keeps posting.
  const nonceKey = `internal-call:${call.nonce}`;
  const claim = crypto.randomUUID();
  const fresh = await redis.set(
    nonceKey,
    claim,
    "PX",
    INTERNAL_CALL_WINDOW_MS * 2,
    "NX"
  );
  if (fresh !== "OK") {
    const holder = await redis.get(nonceKey);
    if (holder !== null && holder !== claim) {
      logger.warn("Refused a repeated internal call", {
        name,
        companyId: call.companyId
      });
      return refuse(409, "This call was already made");
    }
    if (holder === null) {
      logger.warn("Accepted an internal call without a replay check", {
        name,
        companyId: call.companyId
      });
    }
  }

  const handles: PostingHandles = {
    db: getDatabaseClient(),
    companyId: call.companyId,
    userId: call.userId
  };
  if (call.mode === "caller") {
    const token = request.headers
      .get("authorization")!
      .replace(/^Bearer\s+/i, "");
    handles.client = getCarbon(token);
  }

  const result = await posting(name, handles, input as never);
  if (result.error) {
    const { status, message, body: details } = result.error;
    return Response.json(
      { data: null, error: { status, message, body: details } },
      { status }
    );
  }
  return Response.json({ data: result.data, error: null });
}
