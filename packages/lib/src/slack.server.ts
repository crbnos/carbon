import type { Database } from "@carbon/database";
import { getAppUrl, SLACK_BOT_TOKEN } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { WebClientOptions } from "@slack/web-api";
import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";

const log = getLogger("lib", "slack");

interface SlackMessage {
  channel: string;
  text: string;
  blocks?: any[];
}

class SlackClient {
  private client: WebClient;

  constructor(token: string, options?: WebClientOptions) {
    this.client = new WebClient(token, options);
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

export function getSlackClient(
  token?: string,
  options?: WebClientOptions
): SlackClient {
  return new SlackClient(
    token ?? process.env.SLACK_BOT_TOKEN ?? SLACK_BOT_TOKEN ?? "",
    options
  );
}

const SUGGESTION_CHANNEL = "#feedback";
// Slack rejects section blocks over 3000 chars; long text is split, not truncated.
const SECTION_CHAR_LIMIT = 2900;
const MAX_TEXT_BLOCKS = 12;

function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Input is already mrkdwn-escaped; a hard cut backs up so it can't split an entity.
function splitForSections(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + SECTION_CHAR_LIMIT, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      const space = text.lastIndexOf(" ", end);
      const breakAt = Math.max(newline, space);
      if (breakAt > start) {
        end = breakAt;
      } else {
        const amp = text.lastIndexOf("&", end - 1);
        if (amp > start && !text.slice(amp, end).includes(";")) {
          end = amp;
        }
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Posts a customer suggestion to Carbon's own Slack workspace (env
 * SLACK_BOT_TOKEN), NOT the customer's linked workspace. Never throws — Slack
 * being down must not fail the user's submission.
 */
export async function postSuggestionToCarbonSlack(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    companyName?: string | null;
    suggestion: string;
    emoji: string;
    path: string;
    userId?: string | null;
    attachmentPath?: string | null;
  }
): Promise<void> {
  if (!(process.env.SLACK_BOT_TOKEN ?? SLACK_BOT_TOKEN)) {
    return;
  }
  try {
    const [user, attachmentUrl] = await Promise.all([
      input.userId
        ? client
            .from("user")
            .select("firstName, lastName, email")
            .eq("id", input.userId)
            .single()
        : Promise.resolve(null),
      input.attachmentPath
        ? client.storage
            .from("private")
            .createSignedUrl(input.attachmentPath, 60 * 60 * 24 * 7)
            .then((result) => result.data?.signedUrl ?? null)
        : Promise.resolve(null)
    ]);

    const companyName = escapeSlackText(input.companyName ?? input.companyId);
    const submittedBy = user?.data
      ? `${escapeSlackText(
          `${user.data.firstName ?? ""} ${user.data.lastName ?? ""}`.trim()
        )} <${user.data.email ?? ""}>`
      : "Anonymous";

    const chunks = splitForSections(escapeSlackText(input.suggestion));
    const textBlocks = chunks.slice(0, MAX_TEXT_BLOCKS).map((chunk) => ({
      type: "section",
      text: { type: "mrkdwn", text: chunk }
    }));
    if (chunks.length > MAX_TEXT_BLOCKS) {
      textBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "_… suggestion too long for Slack — read the full text in Carbon._"
        }
      });
    }

    // Awaited in the submit request — the default retry policy (~30 min) would hang it.
    await getSlackClient(undefined, {
      retryConfig: { retries: 0 }
    }).sendMessage({
      channel: SUGGESTION_CHANNEL,
      text: `New suggestion from ${companyName}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${input.emoji} New suggestion from *${companyName}*`
          }
        },
        ...textBlocks,
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Submitted by:*\n${submittedBy}` },
            { type: "mrkdwn", text: `*Page:*\n${escapeSlackText(input.path)}` },
            {
              type: "mrkdwn",
              text: `*Attachment:*\n${
                attachmentUrl ? `<${attachmentUrl}|View image>` : "None"
              }`
            }
          ]
        }
      ]
    });
  } catch (error) {
    log.error("Failed to post suggestion to Carbon Slack", { error });
  }
}
