import { getCarbonServiceRole } from "@carbon/auth/client.server";
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
        .select("active, metadata")
        .eq("companyId", companyId)
        .eq("id", "slack")
        .maybeSingle();
      if (error || !data?.active) return null;
      const metadata = data.metadata as { access_token?: string } | null;
      return metadata?.access_token ?? null;
    });

    await step.run("post-message", async () => {
      // Per-company token if the company has Slack linked, else fall back to
      // the env token (legacy single-workspace setups). Client is a no-op on
      // localhost — see slack.server.ts.
      const slack = getSlackClient(accessToken ?? undefined);
      await slack.sendMessage({ blocks, channel, text });
    });

    return { success: true };
  }
);
