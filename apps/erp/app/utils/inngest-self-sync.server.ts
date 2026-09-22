import { sleep } from "@carbon/lib/async";
import { getLogger } from "@carbon/logger";

const log = getLogger("erp", "inngest-self-sync");

const MAX_ATTEMPTS = 10;
const RETRY_DELAY_MS = 2_000;

// A PUT to our own serve endpoint is Inngest's registration handshake — the
// same request `ci/src/jobs.ts` curls from CI after a deploy. Doing it here
// too means a freshly booted task (deploy, ECS reschedule, autoscale-out)
// re-syncs itself immediately instead of waiting on that external job, which
// only fires after a "Deploy Apps" success on `main`. `serveHost` (set from
// INNGEST_SERVE_HOST/ERP_URL in the route) already fixes the URL Inngest is
// told to call back on, so hitting our own loopback address here is
// equivalent to CI hitting the public one.
async function syncInngest() {
  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}/api/inngest`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { method: "PUT" });
      if (response.ok) {
        log.info(
          "Inngest self-sync succeeded on attempt {attempt} ({status})",
          {
            attempt,
            status: response.status
          }
        );
        return;
      }
      log.warn(
        "Inngest self-sync got {status} on attempt {attempt}/{maxAttempts}",
        { status: response.status, attempt, maxAttempts: MAX_ATTEMPTS }
      );
    } catch (error) {
      // Expected for the first attempt or two — the HTTP server isn't
      // listening yet when this fires at module load.
      log.debug(
        "Inngest self-sync attempt {attempt}/{maxAttempts} failed: {message}",
        {
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          message: error instanceof Error ? error.message : String(error)
        }
      );
    }
    await sleep(RETRY_DELAY_MS);
  }

  log.error(
    "Inngest self-sync failed after {maxAttempts} attempts — functions may be stale in Inngest until the next deploy or manual sync",
    { maxAttempts: MAX_ATTEMPTS }
  );
}

const globalForInngestSync = globalThis as typeof globalThis & {
  __carbonInngestSyncStarted?: boolean;
};

/**
 * Fire-and-forget: never awaited by callers, never allowed to affect server
 * boot or liveness either way. Only runs in real production boots
 * (`NODE_ENV=production` — ECS/SST and self-hosted Swarm) — local dev already
 * points a self-hosted Inngest server at `/api/inngest` via `--sdk-url`, and
 * this must never fire during `vitest` runs that import the server entry.
 *
 * Skipped on Vercel (`VERCEL_DEPLOYMENT_ID`, same check `server/app.ts` uses):
 * a serverless function has no persistent port to self-connect to, so this
 * would just retry against a closed connection on every cold start. Vercel's
 * own Inngest integration syncs via a deploy webhook instead — see
 * `.claude/rules/sst-deployment-infrastructure.md`.
 */
export function scheduleInngestSelfSync() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.VERCEL_DEPLOYMENT_ID) return;
  if (globalForInngestSync.__carbonInngestSyncStarted) return;
  globalForInngestSync.__carbonInngestSyncStarted = true;

  void syncInngest();
}
