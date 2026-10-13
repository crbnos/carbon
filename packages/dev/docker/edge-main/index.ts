// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Edge runtime dispatcher. Routes /functions/v1/<name>/* to <name>/index.ts.
// Required by supabase/edge-runtime when started with --main-service.

import { STATUS_CODE } from "https://deno.land/std@0.224.0/http/status.ts";
import { jwtVerify } from "https://deno.land/x/jose@v4.14.4/index.ts";

// The gateway's verify_jwt, which Supabase Cloud applies before a function runs.
// Self-hosted, Kong forwards /functions/v1/ with no auth plugin, so this is the
// check: without it a token claiming `role: service_role` needs no signature.
const VERIFY_JWT = Deno.env.get("VERIFY_JWT") === "true";
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
if (VERIFY_JWT && !JWT_SECRET) {
  // An empty key would accept any token signed with an empty key.
  throw new Error("VERIFY_JWT is on but JWT_SECRET is empty");
}

async function hasValidJwt(req: Request): Promise<boolean> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const fnName = segments[0];
  if (!fnName) {
    return new Response("Not found", { status: STATUS_CODE.NotFound });
  }

  if (
    VERIFY_JWT &&
    req.method !== "OPTIONS" &&
    !(await hasValidJwt(req))
  ) {
    return new Response(JSON.stringify({ msg: "Invalid JWT" }), {
      status: STATUS_CODE.Unauthorized,
      headers: { "content-type": "application/json" }
    });
  }

  const servicePath = `/home/deno/functions/${fnName}`;

  try {
    // @ts-ignore EdgeRuntime is provided by the supabase/edge-runtime image.
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 512,
      workerTimeoutMs: 5 * 60 * 1000,
      // Without explicit budgets the runtime's low defaults (~1s soft / 2s
      // hard CPU) apply — worker BOOT (module evaluation of kysely/zod-heavy
      // functions) alone can blow that, and a hard-limit kill mid-request
      // surfaces as a hanging POST with "CPU time hard limit reached" in the
      // logs. Dev should never kill a worker for CPU; a heavy function
      // (e.g. embedding's model load) legitimately burns it.
      cpuTimeSoftLimitMs: 30 * 1000,
      cpuTimeHardLimitMs: 60 * 1000,
      noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        function: fnName,
      }),
      {
        status: STATUS_CODE.InternalServerError,
        headers: { "content-type": "application/json" },
      }
    );
  }
});
