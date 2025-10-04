import { getAppUrl, SLACK_BOT_TOKEN } from "@carbon/auth";
import { WebClient } from "@slack/web-api";

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
        blocks,
      });
    } catch (error) {
      console.error("Error sending Slack message:", error);
    }
  }
}

export function getSlackClient(): SlackClient {
  return new SlackClient(process.env.SLACK_BOT_TOKEN || SLACK_BOT_TOKEN);
}
