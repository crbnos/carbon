import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import { getSlackClient } from "@carbon/lib/slack.server";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";

/**
 * The only Slack failure that provably posted nothing. A platform error is
 * deterministic (channel_not_found will not fix itself), and a request/HTTP
 * error is ambiguous — Slack may have accepted the message before the response
 * was lost. `chat.postMessage` takes no idempotency key, so the ambiguous cases
 * must not replay. Function-level retries still cover the token lookup step,
 * which is an idempotent read.
 */
const RETRYABLE_SLACK_CODES = new Set(["slack_webapi_rate_limited_error"]);

export const sendSlackFunction = inngest.createFunction(
  {
    id: "send-slack",
    retries: 3
  },
  { event: "carbon/send-slack" },
  async ({ event, step }) => {
    const { channel, text, blocks, companyId } = event.data;

    const accessToken = await step.run("resolve-slack-token", async () => {
      const client = getCarbonServiceRole();
      const { data, error } = await client
        .from("companyIntegration")
        .select("active, metadata, secretRef")
        .eq("companyId", companyId)
        .eq("id", "slack")
        .maybeSingle();
      if (error || !data?.active) return null;
      // Secret material (access_token) lives in Supabase Vault; merge it back
      // so we read the same shape as before. `client` is service-role.
      const metadata = (await resolveIntegrationSecrets(
        client,
        companyId,
        "slack",
        data.metadata,
        data.secretRef
      )) as { access_token?: string } | null;
      return metadata?.access_token ?? null;
    });

    // The channel id only exists in the company's linked workspace, so without
    // that workspace's token there is nothing valid to post — the old env-token
    // fallback sent the id into Carbon's own workspace (channel_not_found).
    if (!accessToken) {
      return { success: false, skipped: "slack-integration-not-linked" };
    }

    await step.run("post-message", async () => {
      // Client is a no-op on localhost — see slack.server.ts.
      const slack = getSlackClient(accessToken);
      try {
        await slack.sendMessage({ blocks, channel, text });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code && RETRYABLE_SLACK_CODES.has(code)) throw err;
        throw new NonRetriableError(
          `Slack error${code ? ` (${code})` : ""}: ${(err as Error).message}`
        );
      }
    });

    return { success: true };
  }
);
