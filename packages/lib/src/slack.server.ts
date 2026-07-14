import { getAppUrl, SLACK_BOT_TOKEN } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import { WebClient } from "@slack/web-api";

const log = getLogger("lib", "slack");

interface SlackMessage {
  channel: string;
  text: string;
  blocks?: any[];
}

class SlackClient {
  private client: WebClient;

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  async sendMessage({ channel, text, blocks }: SlackMessage): Promise<void> {
    const appUrl = getAppUrl();
    if (appUrl.includes("localhost")) {
      return;
    }
    try {
      await this.client.chat.postMessage({
        channel,
        text,
        blocks
      });
    } catch (error) {
      log.error("Error sending Slack message", { error });
    }
  }
}

export function getSlackClient(token?: string): SlackClient {
  return new SlackClient(
    token ?? process.env.SLACK_BOT_TOKEN ?? SLACK_BOT_TOKEN ?? ""
  );
}
