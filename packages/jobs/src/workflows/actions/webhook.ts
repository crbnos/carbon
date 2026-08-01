import type { Database } from "@carbon/database";
import {
  type ActionOutcome,
  isNull,
  primitiveValue,
  type RuntimeValue
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkOutboundUrl } from "./url-guard";

const TIMEOUT_MS = 10_000;
/** Only an excerpt is kept, and only for the step summary. */
const MAX_EXCERPT_BYTES = 2048;

const NO_URL = "This step needs a web address to call.";
const REDIRECTED = "That address redirected, which is not allowed.";
const UNREACHABLE = "The address could not be reached.";

function asText(value: RuntimeValue | undefined): string | undefined {
  if (value === undefined || isNull(value)) return undefined;
  if (value.kind !== "primitive") return undefined;
  return value.value === null ? undefined : String(value.value);
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

  const rawBody = asText(inputs.body) ?? "";

  let response: Response;
  try {
    response = await fetch(verdict.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS)
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

  return {
    ok: true,
    outputs: { status: primitiveValue("number", status) },
    summary:
      excerpt.length === 0
        ? `Answered ${status}.`
        : `Answered ${status}: ${excerpt}`
  };
}
