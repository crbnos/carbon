import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getSlackWorkspace } from "@carbon/ee/slack.server";
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

    // One step, so the token never becomes a step OUTPUT that Inngest would
    // persist in its run state — it lives only in this closure.
    await step.run("post-message", async () => {
      // Per-company token if the company has a usable Slack connection, else
      // fall back to the env token (legacy single-workspace setups). A
      // workspace that cannot be read falls back too rather than failing the
      // send. Client is a no-op on localhost — see slack.server.ts.
      let accessToken: string | undefined;
      try {
        accessToken = (
          await getSlackWorkspace(getCarbonServiceRole(), companyId)
        )?.token;
      } catch {
        accessToken = undefined;
      }
      const slack = getSlackClient(accessToken);
      await slack.sendMessage({ blocks, channel, text });
    });

    return { success: true };
  }
);
