import type { Database } from "@carbon/database";
import {
  type ActionOutcome,
  isNull,
  primitiveValue,
  type RuntimeValue
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
// undici's own fetch, not the global one: the global is whatever undici Node bundled,
// and a dispatcher from a different major is rejected at request time.
import { fetch, type Response } from "undici";
import { checkOutboundUrl, outboundDispatcher } from "./url-guard";

const TIMEOUT_MS = 10_000;
/** Only an excerpt is kept, and only for the step summary. */
const MAX_EXCERPT_BYTES = 2048;

const NO_URL = "This step needs a web address to call.";
const REDIRECTED = "That address redirected, which is not allowed.";
const UNREACHABLE = "The address could not be reached.";

/** Same pattern as ledger.ts — keys whose values should never appear in logs. */
const SECRET_HEADER_NAME =
  /secret|token|password|passwd|credential|signature|authorization|apikey|api_key|client_secret|clientsecret|private_key|privatekey|bearer|cookie/i;

/** What every webhook published before the method input existed relied on. */
const DEFAULT_METHOD = "POST";
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);
/** Framing headers: they change how the request is delivered, not what it says. */
const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "keep-alive",
  "proxy-authorization"
]);

function asText(value: RuntimeValue | undefined): string | undefined {
  if (value === undefined || isNull(value)) return undefined;
  if (value.kind !== "primitive") return undefined;
  return value.value === null ? undefined : String(value.value);
}

function keyMatching(
  headers: Record<string, string>,
  name: string
): string | undefined {
  const wanted = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === wanted);
}

function headersFrom(value: RuntimeValue | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (value === undefined || value.kind !== "pairs") return headers;
  for (const entry of value.entries) {
    const name = entry.name.trim();
    if (name === "" || RESERVED_HEADERS.has(name.toLowerCase())) continue;
    const text = asText(entry.value);
    if (text === undefined || text === "") continue;
    // A later row replaces an earlier one of the same name, whatever its casing.
    const existing = keyMatching(headers, name);
    if (existing !== undefined) delete headers[existing];
    headers[name] = text;
  }
  return headers;
}

export async function runWebhookAction(params: {
  client: SupabaseClient<Database>;
  companyId: string;
  workflowId: string;
  inputs: Record<string, RuntimeValue>;
}): Promise<ActionOutcome> {
  const { inputs } = params;

  const rawUrl = asText(inputs.url);
  if (rawUrl === undefined) return { ok: false, error: NO_URL };

  const verdict = await checkOutboundUrl(rawUrl);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const method = asText(inputs.method)?.trim().toUpperCase() || DEFAULT_METHOD;
  const headers = headersFrom(inputs.headers);
  const carriesBody = METHODS_WITH_BODY.has(method);
  if (carriesBody && keyMatching(headers, "content-type") === undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(verdict.url, {
      method,
      headers,
      // `fetch` throws on a GET carrying a body, which would read as a network fault.
      ...(carriesBody ? { body: asText(inputs.body) ?? "" } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      dispatcher: outboundDispatcher
    });
  } catch {
    return { ok: false, error: UNREACHABLE };
  }

  const status = response.status;
  if (status >= 300 && status < 400) return { ok: false, error: REDIRECTED };
  if (status < 200 || status >= 300) {
    return { ok: false, error: `The address answered ${status}.` };
  }

  let excerpt = "";
  try {
    excerpt = (await response.text()).slice(0, MAX_EXCERPT_BYTES).trim();
  } catch {
    excerpt = "";
  }

  // Scrub any secret-header values from the response excerpt before logging.
  // An echo-style endpoint may bounce received headers back in its response body.
  if (excerpt.length > 0) {
    for (const [name, value] of Object.entries(headers)) {
      if (SECRET_HEADER_NAME.test(name) && value.length > 0) {
        excerpt = excerpt.split(value).join("[REDACTED]");
      }
    }
  }

  return {
    ok: true,
    outputs: { status: primitiveValue("number", status) },
    summary:
      excerpt.length === 0
        ? `Answered ${status}.`
        : `Answered ${status}: ${excerpt}`
  };
}
