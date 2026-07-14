import { requirePermissions } from "@carbon/auth/auth.server";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import type { LoaderFunctionArgs } from "react-router";

const NO_SIGNAL = { phase: null, done: 0, total: 0 } as const;

// Polled by the assembly page while a model converts: resolves the in-flight
// convert job for the model, then proxies the geometry service's live phase
// (downloading / converting / uploading + byte counts for the download).
// phase: null means no live signal — job still queued, already finished, or
// the service doesn't track it — and the client falls back to its coarse
// processingStatus rendering.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });
  const { modelUploadId } = params;
  if (!modelUploadId) throw new Response("Not found", { status: 404 });

  const job = await client
    .from("assemblyPlanJob")
    .select("id")
    .eq("modelUploadId", modelUploadId)
    .eq("companyId", companyId)
    .eq("kind", "convert")
    .eq("status", "Processing")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job.data || !ASSEMBLER_SERVICE_URL) return NO_SIGNAL;

  try {
    const response = await fetch(
      `${ASSEMBLER_SERVICE_URL}/convert/status/${job.data.id}`,
      {
        headers: ASSEMBLER_SERVICE_API_KEY
          ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
          : {},
        signal: AbortSignal.timeout(3000)
      }
    );
    if (!response.ok) return NO_SIGNAL;
    const body = (await response.json()) as {
      phase?: string;
      done?: number;
      total?: number;
    };
    return {
      phase: body.phase ?? null,
      done: body.done ?? 0,
      total: body.total ?? 0
    };
  } catch {
    return NO_SIGNAL;
  }
}
