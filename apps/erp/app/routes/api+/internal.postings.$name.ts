// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  INTERNAL_CALL_WINDOW_MS,
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
// user and the mode (`@carbon/api/internal-call.server`); the signature is the
// only credential, so no cookie is read. In caller mode the user's token rides
// along and the posting checks that user, as it checks any caller's client.

const logger = getLogger("erp", "internal-postings");

const refuse = (status: number, message: string) =>
  Response.json({ data: null, error: { status, message } }, { status });

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return refuse(405, "Method not allowed");
  const name = params.name ?? "";
  const body = await request.text();

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
  const fresh = await redis.set(
    `internal-call:${call.nonce}`,
    "1",
    "PX",
    INTERNAL_CALL_WINDOW_MS * 2,
    "NX"
  );
  if (fresh !== "OK") {
    logger.warn("Refused a repeated internal call", {
      name,
      companyId: call.companyId
    });
    return refuse(409, "This call was already made");
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
