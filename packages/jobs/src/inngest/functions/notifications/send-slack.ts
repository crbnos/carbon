import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import { getSlackClient } from "@carbon/lib/slack.server";
import { inngest } from "../../client";

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
      await slack.sendMessage({ blocks, channel, text });
    });

    return { success: true };
  }
);
