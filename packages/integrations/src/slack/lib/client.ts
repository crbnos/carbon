import Bolt from "@slack/bolt";
import { InstallProvider } from "@slack/oauth";
import { WebClient } from "@slack/web-api";
import { createHmac } from "node:crypto";
import { z } from "zod";

import {
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_OAUTH_REDIRECT_URL,
  SLACK_SIGNING_SECRET,
  SLACK_STATE_SECRET,
} from "@carbon/auth";

const { App } = Bolt;

export const slackOAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
});

export const slackOAuthTokenResponseSchema = z.object({
  ok: z.literal(true),
  app_id: z.string(),
  authed_user: z.object({
    id: z.string(),
  }),
  scope: z.string(),
  token_type: z.literal("bot"),
  access_token: z.string(),
  bot_user_id: z.string(),
  team: z.object({
    id: z.string(),
    name: z.string(),
  }),
  // incoming_webhook is only present when the app has incoming-webhook scope
  incoming_webhook: z
    .object({
      channel: z.string(),
      channel_id: z.string(),
      configuration_url: z.string().url(),
      url: z.string().url(),
    })
    .optional(),
  // Enterprise field can be an object, null, or missing
  enterprise: z
    .object({
      name: z.string(),
      id: z.string(),
    })
    .nullable()
    .optional(),
});

// Legacy export for backward compatibility - should be removed eventually
export const slackAuthResponseSchema = slackOAuthTokenResponseSchema;

let slackInstaller: InstallProvider | null = null;

export const createSlackApp = ({
  token,
  botId,
}: {
  token: string;
  botId: string;
}) => {
  return new App({
    signingSecret: SLACK_SIGNING_SECRET,
    token,
    botId,
  });
};

export const getSlackInstaller = (): InstallProvider => {
  if (!slackInstaller) {
    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
      throw new Error("Slack client credentials are required but not provided");
    }

    slackInstaller = new InstallProvider({
      clientId: SLACK_CLIENT_ID,
      clientSecret: SLACK_CLIENT_SECRET,
      stateSecret: SLACK_STATE_SECRET,
      logLevel:
        process.env.NODE_ENV === "development"
          ? Bolt.LogLevel.DEBUG
          : undefined,
    });
  }
  return slackInstaller;
};

export const createSlackWebClient = ({ token }: { token: string }) => {
  return new WebClient(token);
};

export const getSlackInstallUrl = ({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) => {
  return getSlackInstaller().generateInstallUrl({
    scopes: [
      "incoming-webhook",
      "chat:write",
      "chat:write.public",
      "team:read",
      "assistant:write",
      "im:history",
      "commands",
      "files:read",
    ],
    redirectUri: SLACK_OAUTH_REDIRECT_URL,
    metadata: JSON.stringify({ companyId, userId }),
  });
};

export async function verifySlackWebhook(req: Request) {
  if (!SLACK_SIGNING_SECRET) {
    throw new Error("SLACK_SIGNING_SECRET is not set");
  }

  const fiveMinutesInSeconds = 5 * 60;
  const slackSignatureVersion = "v0";

  const body = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const slackSignature = req.headers.get("x-slack-signature");

  if (!timestamp || !slackSignature) {
    throw new Error("Missing required Slack headers");
  }

  const currentTime = Math.floor(Date.now() / 1000);
  if (
    Math.abs(currentTime - Number.parseInt(timestamp)) > fiveMinutesInSeconds
  ) {
    throw new Error("Request is too old");
  }

  const sigBasestring = `${slackSignatureVersion}:${timestamp}:${body}`;
  const mySignature = createHmac("sha256", SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest("hex");

  if (`${slackSignatureVersion}=${mySignature}` !== slackSignature) {
    throw new Error("Invalid Slack signature");
  }

  return JSON.parse(body);
}

/**
 * Post a message to a Slack thread
 */
export async function postToSlackThread({
  token,
  channelId,
  threadTs,
  blocks,
  text,
}: {
  token: string;
  channelId: string;
  threadTs: string;
  blocks?: any[];
  text?: string;
}) {
  const client = createSlackWebClient({ token });

  return client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks,
    text: text || "Message from Carbon",
    unfurl_links: false,
    unfurl_media: false,
  });
}

/**
 * Create a new Slack thread
 */
export async function createSlackThread({
  token,
  channelId,
  blocks,
  text,
}: {
  token: string;
  channelId: string;
  blocks?: any[];
  text?: string;
}) {
  const client = createSlackWebClient({ token });

  return client.chat.postMessage({
    channel: channelId,
    blocks,
    text: text || "New thread from Carbon",
    unfurl_links: false,
    unfurl_media: false,
  });
}

/**
 * Update a Slack message
 */
export async function updateSlackMessage({
  token,
  channelId,
  ts,
  blocks,
  text,
}: {
  token: string;
  channelId: string;
  ts: string;
  blocks?: any[];
  text?: string;
}) {
  const client = createSlackWebClient({ token });

  return client.chat.update({
    channel: channelId,
    ts,
    blocks,
    text: text || "Updated message from Carbon",
  });
}

/**
 * Get thread replies from Slack
 */
export async function getSlackThreadReplies({
  token,
  channelId,
  threadTs,
  limit = 100,
}: {
  token: string;
  channelId: string;
  threadTs: string;
  limit?: number;
}) {
  const client = createSlackWebClient({ token });

  return client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit,
  });
}
