import { createHmac } from "node:crypto";
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
const NO_SECRET = "This workflow has no signing secret.";
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
  const { client, companyId, workflowId, inputs } = params;

  const rawUrl = asText(inputs.url);
  if (rawUrl === undefined) return { ok: false, error: NO_URL };

  const verdict = await checkOutboundUrl(rawUrl);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const workflow = await client
    .from("workflow")
    .select("webhookSecret")
    .eq("id", workflowId)
    .eq("companyId", companyId)
    .single();
  const secret = workflow.data?.webhookSecret;
  if (workflow.error !== null || !secret) {
    return { ok: false, error: NO_SECRET };
  }

  // Signed over the exact bytes sent, so the receiver can verify what it got.
  const rawBody = asText(inputs.body) ?? "";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`v1:${timestamp}:${rawBody}`)
    .digest("hex");

  let response: Response;
  try {
    response = await fetch(verdict.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Carbon-Timestamp": String(timestamp),
        "Carbon-Signature": `v1=${signature}`
      },
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
