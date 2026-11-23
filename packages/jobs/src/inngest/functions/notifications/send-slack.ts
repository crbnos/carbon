// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getSlackWorkspace } from "@carbon/ee/slack.server";
import { getSlackClient } from "@carbon/lib/slack.server";
import { inngest } from "../../client";
import { slackDeliveryFailure } from "./delivery-failure";

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
    const result = await step.run("post-message", async () => {
      // The company's own Slack connection. A failed read throws, so the step
      // retries: it must not read as "not linked" and drop the message.
      const accessToken = (
        await getSlackWorkspace(getCarbonServiceRole(), companyId)
      )?.token;

      // The channel id only exists in the company's linked workspace, so without
      // that workspace's token there is nothing valid to post — the old env-token
      // fallback sent the id into Carbon's own workspace (channel_not_found).
      if (!accessToken) {
        return { success: false, skipped: "slack-integration-not-linked" };
      }

      // Client is a no-op on localhost — see slack.server.ts.
      // `retries: 0` because Inngest owns the retry policy here: the SDK's
      // default is ~10 attempts over ~30 minutes, which would both stall this
      // step and retry the ambiguous failures classified below.
      // `rejectRateLimitedCalls` so a 429 arrives as a RateLimitedError the
      // classifier can recognise. Left at its default, the SDK sleeps the
      // whole Retry-After inside this step and then throws a bare Error with
      // no `code`, which the classifier would read as ambiguous and drop.
      const slack = getSlackClient(accessToken, {
        retryConfig: { retries: 0 },
        rejectRateLimitedCalls: true
      });
      try {
        await slack.sendMessage({ blocks, channel, text });
      } catch (err) {
        throw slackDeliveryFailure(err);
      }
      return { success: true };
    });

    return result;
  }
);
