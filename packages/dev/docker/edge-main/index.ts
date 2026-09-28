// Edge runtime dispatcher. Routes /functions/v1/<name>/* to <name>/index.ts.
// Required by supabase/edge-runtime when started with --main-service.

import { STATUS_CODE } from "https://deno.land/std@0.224.0/http/status.ts";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const fnName = segments[0];
  if (!fnName) {
    return new Response("Not found", { status: STATUS_CODE.NotFound });
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
      // logs. Dev should never kill a worker for CPU; heavy functions (mrp,
      // schedule, get-method, batch-operations) legitimately burn it.
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
