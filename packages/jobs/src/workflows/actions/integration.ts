// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  type ActionOutcome,
  MAX_LIST_ITEMS,
  type RuntimeValue
} from "@carbon/ee/workflows";
import { redactForLog } from "../engine/ledger";
import { allowlistEntry } from "../integrations/allowlist";
import { buildPieceContext } from "../integrations/context";
import {
  type PieceAuthFailure,
  resolvePieceAuth
} from "../integrations/piece-auth";
import { droppedItems, projectOutputs } from "../integrations/project";
import { toPropsValue } from "../integrations/properties";
import { getPieceAction } from "../integrations/registry";

const NO_CONNECTION = "This step needs a connection.";
/** A workspace connected before this piece needed a scope. The fix is one click,
 * so the words name it — a bare `missing_scope` reads as a bug report. */
const reconnectCopy = (label: string) =>
  `The ${label} connection needs to be reconnected to grant the permissions this step uses — Settings → Integrations → ${label} → Accounts → Reconnect.`;
/** The codes vendors use for "this token lacks a scope": Slack's Web API
 * (`missing_scope`), OAuth 2.0 (`insufficient_scope`) and Google
 * (`insufficientPermissions`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`). */
const SCOPE_CODES = new Set([
  "missing_scope",
  "insufficient_scope",
  "insufficientPermissions",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT"
]);
/** A vendor message is theirs, not ours — keep it short enough to read in a step row. */
const MAX_VENDOR_MESSAGE = 300;

function truncate(message: string): string {
  return message.length <= MAX_VENDOR_MESSAGE
    ? message
    : `${message.slice(0, MAX_VENDOR_MESSAGE)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsedBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Read off the vendor's structured error, never its message: an Activepieces
 * `HttpError` message embeds the REQUEST body, so an email that merely says
 * "insufficient permission" read as a scope error. Three shapes reach here:
 * Slack's Web API error (`data.error`), the Activepieces `HttpError`
 * (`responseBody`) and a googleapis `GaxiosError` (`response.data`). */
function isScopeError(cause: unknown): boolean {
  if (!isRecord(cause)) return false;
  const codes: unknown[] = [];
  if (isRecord(cause.data)) codes.push(cause.data.error);
  const response = isRecord(cause.response) ? cause.response : undefined;
  for (const raw of [cause.responseBody, response?.data]) {
    const body = parsedBody(raw);
    if (!isRecord(body)) continue;
    const error = body.error;
    if (!isRecord(error)) {
      codes.push(error);
      continue;
    }
    for (const list of [error.errors, error.details]) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) if (isRecord(entry)) codes.push(entry.reason);
    }
  }
  return codes.some(
    (code) => typeof code === "string" && SCOPE_CODES.has(code)
  );
}

/** The vendor's own words for a failure, read from its RESPONSE: Slack's
 * `data.error`, or the body's `error.message` / `error` / `message`. Never
 * `cause.message` when the error carries a request — an Activepieces `HttpError`
 * message is JSON of the response AND the request, so an email's recipients and
 * body landed in run history. A plain error from our own code keeps its message. */
function vendorMessage(cause: unknown): string {
  if (!isRecord(cause)) return "The step did not complete.";
  if (isRecord(cause.data) && typeof cause.data.error === "string") {
    return cause.data.error;
  }
  const response = isRecord(cause.response) ? cause.response : undefined;
  for (const raw of [cause.responseBody, response?.data]) {
    const body = parsedBody(raw);
    if (!isRecord(body)) continue;
    const { error } = body;
    if (isRecord(error) && typeof error.message === "string") {
      return error.message;
    }
    if (typeof error === "string") {
      return typeof body.error_description === "string"
        ? `${error}: ${body.error_description}`
        : error;
    }
    if (typeof body.message === "string") return body.message;
  }
  const status = cause.status ?? response?.status;
  if (typeof status === "number") return `HTTP ${status}`;
  const carriesRequest =
    "request" in cause || "requestBody" in cause || "config" in cause;
  if (cause instanceof Error && !carriesRequest) return cause.message;
  return "The step did not complete.";
}

/** A googleapis response carries the request it was made with under `config`
 * (the base64 email body included) and `request`; neither is the result. */
function dropTransport(key: string, value: unknown): unknown {
  return key === "config" || key === "request" ? undefined : value;
}

/** The raw result as JSON for the `result` output. Called only after the vendor
 * call returned, so a result that cannot be serialized (circular, BigInt) is
 * `null` — never a failure: the message has already been sent. */
function serializeResult(result: unknown): string | null {
  if (typeof result === "string") return result;
  try {
    const plain = JSON.stringify(result, dropTransport);
    if (plain === undefined) return null;
    return JSON.stringify(redactForLog(JSON.parse(plain))) ?? null;
  } catch {
    return null;
  }
}

function connectionIdFrom(
  inputs: Record<string, RuntimeValue>
): string | undefined {
  const value = inputs.connectionId;
  if (value === undefined || value.kind !== "primitive") return undefined;
  if (value.value === null) return undefined;
  const id = String(value.value).trim();
  return id === "" ? undefined : id;
}

/** What the step row says when the connection cannot act. A busy refresh is
 * transient and a retry fixes it; a revoked or unreadable token needs a person —
 * telling the customer to reconnect in the first case would send them to do work
 * that changes nothing. */
function authFailureCopy(failure: PieceAuthFailure, label: string): string {
  switch (failure.reason) {
    case "no-connection":
      return NO_CONNECTION;
    case "missing-scopes":
      return reconnectCopy(label);
    case "refreshing":
      return `The ${label} connection was busy refreshing. Try again.`;
    case "reconnect":
      return `The ${label} connection needs to be reconnected.`;
    // Ours, not theirs — a missing OAuth app reaches here.
    case "misconfigured":
    case "failed":
      return `The ${label} connection is unavailable.`;
  }
}

export async function runIntegrationAction(
  args: {
    companyId: string;
    pieceName: string;
    actionName: string;
    inputs: Record<string, RuntimeValue>;
  },
  /** A test passes a fake piece instead of the vendor's npm package. */
  loadAction: typeof getPieceAction = getPieceAction
): Promise<ActionOutcome> {
  const { companyId, pieceName, actionName, inputs } = args;
  const label = allowlistEntry(pieceName)?.label ?? pieceName;

  const connectionId = connectionIdFrom(inputs);
  if (connectionId === undefined) return { ok: false, error: NO_CONNECTION };

  // Service role, scoped by the run's `companyId`: RLS on the row asks for
  // `settings_view`, but the builder offers connections to anyone who can edit
  // workflows, so an owner-client read refused an account the author could pick.
  const auth = await resolvePieceAuth(
    getCarbonServiceRole(),
    companyId,
    pieceName,
    connectionId
  );
  if (!auth.ok) return { ok: false, error: authFailureCopy(auth, label) };

  let action: Awaited<ReturnType<typeof getPieceAction>>;
  let propsValue: Record<string, unknown>;
  try {
    action = await loadAction(pieceName, actionName);
    propsValue = toPropsValue(pieceName, actionName, action.props, inputs);
  } catch {
    // Ours, before any vendor call: nothing was sent.
    return { ok: false, error: `The ${label} step is not available.` };
  }

  // Only a throw from the vendor call is the vendor's failure. Everything after it
  // runs once the call has already had its effect, so it must not report a sent
  // message as rejected — a re-run would send it twice.
  let result: unknown;
  try {
    result = await action.run(
      buildPieceContext({
        auth: { access_token: auth.accessToken },
        propsValue
      })
    );
  } catch (cause) {
    // A vendor scope error still reads as "reconnect", not as a bug.
    if (isScopeError(cause)) {
      return { ok: false, error: reconnectCopy(label) };
    }
    return {
      ok: false,
      error: `${label} rejected this: ${truncate(vendorMessage(cause))}`
    };
  }

  const projected = projectOutputs(action.outputSchema, result, {
    sortItemsBy: allowlistEntry(pieceName)?.sortItemsBy?.[actionName]
  });
  // Said on the step itself: otherwise "count 250" beside "100 items" reads as a bug,
  // and a filter downstream quietly misses what was cut.
  const dropped = droppedItems(projected);
  return {
    ok: true,
    outputs: {
      ...projected,
      result: {
        kind: "primitive",
        of: "string",
        value: serializeResult(result)
      }
    },
    summary:
      dropped > 0
        ? `${label}: ${action.displayName} ran. ${MAX_LIST_ITEMS + dropped} came back; only the first ${MAX_LIST_ITEMS} are used.`
        : `${label}: ${action.displayName} ran.`
  };
}
