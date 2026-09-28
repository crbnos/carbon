/**
 * Auth-failure handling for the accounting crons. Kept out of
 * accounting-sync-operations.ts on purpose: that module is imported by the
 * pure decision tests, and @carbon/kv boots @carbon/env on import.
 */
import type { Database } from "@carbon/database";
import { AccountingAuthError } from "@carbon/ee/accounting";
import { redis } from "@carbon/kv";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GetStepTools } from "inngest";
import type { inngest } from "../../client";

const AUTH_FAILURE_NOTIFY_TTL_SECONDS = 24 * 60 * 60;
const AUTH_FAILURE_COUNTER_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * Consecutive auth failures before the integration is switched off. The pull
 * and outbound sweeps each hit it twice an hour, so this is roughly three
 * hours of a provably dead grant — long enough that a reconnect in progress
 * is not cut off, short enough that a dead integration does not sit "active"
 * for weeks while every sync silently does nothing.
 */
export const AUTH_FAILURE_DISABLE_THRESHOLD = 12;

const authFailureCounterKey = (companyId: string, providerId: string) =>
  `integrations:${companyId}:${providerId}:auth-failures`;

async function notifyIntegration(args: {
  companyId: string;
  providerId: string;
  recipientId: string | null | undefined;
  title: string;
  body: string;
}): Promise<void> {
  const { companyId, providerId, recipientId, title, body } = args;
  if (!recipientId || recipientId === "system") return;
  try {
    await trigger("notify", {
      event: NotificationEvent.IntegrationSync,
      companyId,
      documentId: providerId,
      title,
      body,
      recipient: { type: "user", userId: recipientId }
    });
  } catch (notifyError) {
    console.error(
      `[ACCOUNTING SYNC] ${companyId}/${providerId}: failed to send notification`,
      notifyError
    );
  }
}

/**
 * Record one auth failure against the integration. Below the threshold the
 * configurer is told to reconnect (once a day — every cron hits the same dead
 * token every 30 minutes); at the threshold the integration is deactivated so
 * it stops being swept, and the configurer is told that instead. Reconnecting
 * through the OAuth callback upserts `active: true` again. Never throws.
 */
export async function recordIntegrationAuthFailure(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    providerId: string;
    recipientId: string | null | undefined;
  }
): Promise<"notified" | "deactivated" | "muted"> {
  const { companyId, providerId, recipientId } = args;
  try {
    const counterKey = authFailureCounterKey(companyId, providerId);
    const failures = await redis.incr(counterKey);
    await redis.expire(counterKey, AUTH_FAILURE_COUNTER_TTL_SECONDS);

    if (failures >= AUTH_FAILURE_DISABLE_THRESHOLD) {
      const deactivated = await client
        .from("companyIntegration")
        .update({ active: false, updatedAt: new Date().toISOString() })
        .eq("id", providerId)
        .eq("companyId", companyId);
      if (deactivated.error) throw deactivated.error;
      // Same keys apps/erp's clearCompanyIntegrationCache clears
      await redis.del(
        `integrations:${companyId}`,
        `json:integrations:${companyId}`,
        counterKey
      );
      await notifyIntegration({
        companyId,
        providerId,
        recipientId,
        title: "Accounting integration disabled",
        body: `${providerId} was disabled after ${failures} consecutive authentication failures — reconnect it in Settings → Integrations to resume sync`
      });
      return "deactivated";
    }

    const first = await redis.set(
      `integrations:${companyId}:${providerId}:auth-failed`,
      "1",
      "EX",
      AUTH_FAILURE_NOTIFY_TTL_SECONDS,
      "NX"
    );
    if (first !== "OK") return "muted";
    await notifyIntegration({
      companyId,
      providerId,
      recipientId,
      title: "Accounting integration disconnected",
      body: `Carbon can no longer authenticate with ${providerId} — reconnect it in Settings → Integrations to resume sync`
    });
    return "notified";
  } catch (error) {
    console.error(
      `[ACCOUNTING SYNC] ${companyId}/${providerId}: failed to record auth failure`,
      error
    );
    return "muted";
  }
}

export type CompanySweepTarget = {
  companyId: string;
  providerId: string;
  /** Who configured the integration — the auth-failure recipient. */
  updatedBy?: string | null;
};

export type IsolatedStepOutcome<T> =
  | T
  | { authFailed: string }
  | { error: string };

/**
 * Run one tenant's work as its own step inside a cron that walks every
 * company. Two things must never happen: a dead OAuth grant must not be
 * retried (nothing retries it back to life — the step returns `authFailed`,
 * the failure is counted and the configurer is told), and a tenant that
 * exhausts its retries must not fail the run for every tenant after it
 * (`error` is returned and the loop continues).
 */
export async function runIsolatedCompanyStep<T>(args: {
  step: Pick<GetStepTools<typeof inngest>, "run">;
  client: SupabaseClient<Database>;
  id: string;
  target: CompanySweepTarget;
  fn: () => Promise<T>;
}): Promise<IsolatedStepOutcome<T>> {
  const { step, client, id, target, fn } = args;
  try {
    // Step output is JSON-serialised on replay; the summaries here are plain
    // JSON already, so the round-trip is the identity.
    return (await step.run(id, async () => {
      try {
        const result = await fn();
        // A successful pass proves the grant is alive again
        await redis
          .del(authFailureCounterKey(target.companyId, target.providerId))
          .catch(() => {});
        return result;
      } catch (error) {
        if (error instanceof AccountingAuthError) {
          const outcome = await recordIntegrationAuthFailure(client, {
            companyId: target.companyId,
            providerId: target.providerId,
            recipientId: target.updatedBy
          });
          return { authFailed: `${outcome}: ${error.message}` };
        }
        throw error;
      }
    })) as IsolatedStepOutcome<T>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[ACCOUNTING SYNC] ${target.companyId}/${target.providerId}: ${id} failed after retries: ${message}`
    );
    return { error: message };
  }
}
