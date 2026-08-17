/**
 * Stripe Connect payment pull sweep — the correctness guarantee behind the
 * webhook handler. Webhooks are a latency optimization; deliveries can be
 * missed, disabled after repeated failures, or unreachable for firewalled
 * self-hosted instances. This cron runs every 30 minutes and catches anything
 * the webhook missed.
 *
 * Per active Stripe Connect company:
 * 1. Read the sweep cursor from `metadata.settings.pullCursor`; default = the
 *    integration row's `updatedAt` (ensures we don't pull pre-install history).
 * 2. List all paid invoices from Stripe since the cursor.
 * 3. For each, call `recordStripeConnectPayment` — idempotent on the Stripe
 *    invoice id via the `externalIntegrationMapping` unique index.
 * 4. Advance the cursor to the latest `status_transitions.paid_at` seen only
 *    when all processing succeeded (Celigo cursor rule).
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { recordStripeConnectPayment } from "@carbon/ee/stripe-connect.server";
import type { ConnectInvoice } from "@carbon/stripe/connect.server";
import { stripe } from "@carbon/stripe/stripe.server";
import { inngest } from "../../client";

const INTEGRATION_ID = "stripe-connect";

export const stripeConnectPullSweepFunction = inngest.createFunction(
  { id: "stripe-connect-pull-sweep", retries: 2 },
  { cron: "*/30 * * * *" }, // offset from the accounting pull sweep (*/30)
  async ({ step, logger }) => {
    const client = getCarbonServiceRole();

    const targets = await step.run("find-stripe-connect-targets", async () => {
      const integrations = await client
        .from("companyIntegration")
        .select("id, companyId, metadata, updatedAt")
        .eq("id", INTEGRATION_ID)
        .eq("active", true);

      if (integrations.error) {
        throw new Error(
          `Failed to list Stripe Connect integrations: ${integrations.error.message}`
        );
      }

      return (integrations.data ?? []).map((row) => ({
        companyId: row.companyId,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        updatedAt: row.updatedAt
      }));
    });

    if (targets.length === 0) {
      return { targets: 0, results: [] };
    }

    const results: Array<{
      companyId: string;
      invoicesFound: number;
      recorded: number;
      skipped: number;
      errors: number;
      cursorAdvancedTo: number | null;
      skippedReason?: string;
    }> = [];

    for (const target of targets) {
      const result = await step.run(
        `stripe-connect-sweep-${target.companyId}`,
        async () => {
          const { companyId, metadata } = target;

          const stripeAccountId = (
            metadata.settings as Record<string, unknown> | undefined
          )?.stripeAccountId as string | undefined;

          if (!stripeAccountId) {
            return {
              companyId,
              invoicesFound: 0,
              recorded: 0,
              skipped: 0,
              errors: 0,
              cursorAdvancedTo: null,
              skippedReason: "no stripeAccountId in metadata"
            };
          }

          // Cursor is a Unix timestamp (seconds). Default = integration
          // updatedAt so we don't reach back before install.
          const settings = (metadata.settings ?? {}) as Record<string, unknown>;
          const storedCursor = settings.pullCursor as number | undefined;
          const fallbackCursor = target.updatedAt
            ? Math.floor(new Date(target.updatedAt).getTime() / 1000)
            : Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7; // 7 days max

          const since = storedCursor ?? fallbackCursor;

          if (!stripe) {
            return {
              companyId,
              invoicesFound: 0,
              recorded: 0,
              skipped: 0,
              errors: 0,
              cursorAdvancedTo: null,
              skippedReason:
                "Stripe client not initialized (STRIPE_SECRET_KEY not set)"
            };
          }

          // Page through all paid invoices since the cursor.
          type StripeInvoice = Awaited<
            ReturnType<typeof stripe.invoices.list>
          >["data"][number];
          const invoices: StripeInvoice[] = [];
          let hasMore = true;
          let startingAfter: string | undefined;

          while (hasMore) {
            const page = await stripe.invoices.list(
              {
                status: "paid",
                created: { gte: since },
                limit: 100,
                ...(startingAfter ? { starting_after: startingAfter } : {})
              },
              { stripeAccount: stripeAccountId }
            );

            invoices.push(...page.data);
            hasMore = page.has_more;
            const last = page.data.at(-1);
            if (last) {
              startingAfter = last.id;
            } else {
              hasMore = false;
            }
          }

          const summary = {
            companyId,
            invoicesFound: invoices.length,
            recorded: 0,
            skipped: 0,
            errors: 0,
            cursorAdvancedTo: null as number | null
          };

          if (invoices.length === 0) {
            return summary;
          }

          let latestPaidAt: number | null = null;
          let anyError = false;

          for (const invoice of invoices) {
            try {
              const result = await recordStripeConnectPayment({
                companyId,
                stripeAccountId,
                integrationMetadata: settings,
                stripeInvoice: invoice as ConnectInvoice
              });

              if (result.status === "recorded") {
                summary.recorded++;
              } else {
                summary.skipped++;
                logger.info(
                  `[stripe-connect-pull-sweep] ${companyId}: skipped ${invoice.id}: ${result.reason}`
                );
              }

              const paidAt = invoice.status_transitions?.paid_at;
              if (paidAt && (latestPaidAt === null || paidAt > latestPaidAt)) {
                latestPaidAt = paidAt;
              }
            } catch (err) {
              summary.errors++;
              anyError = true;
              logger.error(
                `[stripe-connect-pull-sweep] ${companyId}: error processing ${invoice.id}`,
                { error: err }
              );
            }
          }

          // Celigo cursor rule: only advance when all processing succeeded.
          // A partial error holds the cursor so the next run re-fetches the
          // same window, naturally retrying any failed invoice.
          if (!anyError && latestPaidAt !== null && latestPaidAt > since) {
            const newCursor = latestPaidAt + 1;
            await storePullCursor(client, companyId, newCursor);
            summary.cursorAdvancedTo = newCursor;
          } else if (anyError) {
            logger.warn(
              `[stripe-connect-pull-sweep] ${companyId}: ${summary.errors} error(s); holding cursor at ${since} for retry`
            );
          }

          return summary;
        }
      );

      results.push(result);
    }

    return { targets: targets.length, results };
  }
);

/**
 * Read-modify-write on the raw metadata so no sibling key is clobbered —
 * same contract as `storePullCursor` in accounting-pull-sweep.ts.
 */
async function storePullCursor(
  client: ReturnType<typeof getCarbonServiceRole>,
  companyId: string,
  cursor: number
): Promise<void> {
  const current = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("id", INTEGRATION_ID)
    .eq("companyId", companyId)
    .single();

  if (current.error) {
    throw new Error(
      `Failed to read integration metadata for cursor store: ${current.error.message}`
    );
  }

  const existing = (current.data?.metadata ?? {}) as Record<string, unknown>;
  const settings = (existing.settings ?? {}) as Record<string, unknown>;
  const merged = {
    ...existing,
    settings: {
      ...settings,
      pullCursor: cursor
    }
  };

  const updated = await client
    .from("companyIntegration")
    .update({ metadata: merged as any })
    .eq("id", INTEGRATION_ID)
    .eq("companyId", companyId);

  if (updated.error) {
    throw new Error(
      `Failed to store Stripe Connect pull cursor: ${updated.error.message}`
    );
  }
}
