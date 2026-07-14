import { ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { trigger } from "@carbon/jobs";
import { isInternalEmail } from "@carbon/utils";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// The geometry (assembler) service backs model conversion and motion planning.
// When it's unreachable those actions can't run, so loaders probe its health and
// the UI soft-gates the assembler-dependent controls. Result cached briefly so a
// navigation burst doesn't fan out one probe per route.
const ASSEMBLER_HEALTH_TTL_MS = 15_000;
const ASSEMBLER_HEALTH_TIMEOUT_MS = 2_000;
let assemblerHealthCache: { healthy: boolean; expires: number } | null = null;

export async function isAssemblerServiceHealthy(): Promise<boolean> {
  if (!ASSEMBLER_SERVICE_URL) return false;

  const now = Date.now();
  if (assemblerHealthCache && assemblerHealthCache.expires > now) {
    return assemblerHealthCache.healthy;
  }

  let healthy = false;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ASSEMBLER_HEALTH_TIMEOUT_MS
  );
  try {
    const response = await fetch(`${ASSEMBLER_SERVICE_URL}/health`, {
      method: "GET",
      signal: controller.signal
    });
    healthy = response.ok;
  } catch {
    healthy = false;
  } finally {
    clearTimeout(timeout);
  }

  assemblerHealthCache = {
    healthy,
    expires: now + ASSEMBLER_HEALTH_TTL_MS
  };
  return healthy;
}

/**
 * Assemblies (animated work instructions) are internal-only while the module
 * matures. Mirrors the backups gate in settings.
 */
export function requireAssembliesInternal(email: string | null) {
  if (!isInternalEmail(email)) {
    throw redirect(path.to.production);
  }
}

/**
 * Triggers a job scheduling task via inngest.
 * Supports both initial scheduling and rescheduling.
 */
export async function triggerJobSchedule(
  jobId: string,
  companyId: string,
  userId: string,
  mode: "initial" | "reschedule" = "reschedule",
  direction: "backward" | "forward" = "backward"
) {
  const result = await trigger("schedule-job", {
    jobId,
    companyId,
    userId,
    mode,
    direction
  });

  return { success: true, runId: result.ids[0] };
}

/**
 * @deprecated Use triggerJobSchedule with mode="reschedule" instead.
 */
export async function triggerJobReschedule(
  jobId: string,
  companyId: string,
  userId: string
) {
  return triggerJobSchedule(jobId, companyId, userId, "reschedule", "backward");
}
