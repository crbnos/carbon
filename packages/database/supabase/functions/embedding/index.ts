// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Text → gte-small embeddings (384 dims) on Supabase's built-in model runtime.
// Self-contained: nothing is imported from outside this directory.
//
//   { text: string }    → { embedding: number[] }     (the ERP's search helper)
//   { texts: string[] } → { embeddings: number[][] }  (the jobs' embedding-queue drain)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.33.1";
import { decodeJwt, jwtVerify } from "npm:jose@5.9.6";
import { createHash } from "node:crypto";

const MAX_TEXTS = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, carbon-key",
};

// The edge runtime's built-in model API (a global, undeclared by functions-js).
declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(
        input: string,
        options: { mean_pool: boolean; normalize: boolean }
      ): Promise<unknown>;
    };
  };
};

const model = new Supabase.ai.Session("gte-small");

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

/** Removes null bytes and control characters, which break the model call. */
function sanitize(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function embed(text: string): Promise<number[]> {
  const sanitized = sanitize(text);
  if (!sanitized) {
    throw new HttpError("Cannot generate embedding for empty text", 400);
  }
  return (await model.run(sanitized, {
    mean_pool: true,
    normalize: true,
  })) as number[];
}

// ---------------------------------------------------------------------------
// Caller check: the service role, a signed-in user, or a valid API key.
// `verify_jwt` lets the published anon key through, so this is the only gate.
// ---------------------------------------------------------------------------

const env = (name: string) => (Deno.env.get(name) ?? "").trim();

/** With JWT_SECRET set (self-host, local dev) the signature is verified here;
 *  on Supabase Cloud the gateway already verified it. */
async function jwtRole(token: string): Promise<string | undefined> {
  if (token.split(".").length !== 3) return undefined;
  try {
    const secret = env("JWT_SECRET");
    const claims = secret
      ? (await jwtVerify(token, new TextEncoder().encode(secret))).payload
      : decodeJwt(token);
    return (claims as { role?: string }).role;
  } catch {
    return undefined;
  }
}

async function requireApiKey(apiKey: string): Promise<void> {
  const serviceRole = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const { data: row } = await serviceRole
    .from("apiKey")
    .select("id, rateLimit, rateLimitWindow, expiresAt")
    .eq("keyHash", keyHash)
    .maybeSingle();
  if (!row || (row.expiresAt && Date.parse(row.expiresAt) < Date.now())) {
    throw new HttpError("Invalid API key", 401);
  }
  const { data: limit, error } = await serviceRole.rpc("check_api_key_rate_limit", {
    p_api_key_id: row.id,
    p_limit: row.rateLimit ?? 20,
    p_window: row.rateLimitWindow ?? "1m",
  });
  if (error) throw error;
  if (!(limit as { success: boolean }).success) {
    throw new HttpError("Rate limit exceeded", 429);
  }
}

async function requireCaller(req: Request): Promise<void> {
  const apiKey = req.headers.get("carbon-key");
  if (apiKey) return requireApiKey(apiKey);

  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (token && token === env("SUPABASE_SERVICE_ROLE_KEY")) return;
  const role = await jwtRole(token);
  if (role === "service_role" || role === "authenticated") return;
  throw new HttpError("Sign in or use an API key", 401);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireCaller(req);

    const body = await req.json().catch(() => null);
    if (typeof body?.text === "string") {
      return json({ embedding: await embed(body.text) });
    }
    if (
      Array.isArray(body?.texts) &&
      body.texts.length <= MAX_TEXTS &&
      body.texts.every((text: unknown) => typeof text === "string")
    ) {
      const embeddings: number[][] = [];
      for (const text of body.texts as string[]) {
        embeddings.push(await embed(text));
      }
      return json({ embeddings });
    }
    throw new HttpError(
      `Send { text: string } or { texts: string[] } (at most ${MAX_TEXTS})`,
      400
    );
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error("embedding failed", err);
    return json({ message: err instanceof Error ? err.message : "" }, status);
  }
});
