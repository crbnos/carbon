import { LogLevel, App as SlackApp } from "@slack/bolt";
import { InstallProvider } from "@slack/oauth";
import { WebClient } from "@slack/web-api";
import { z } from "zod";

import {
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_OAUTH_REDIRECT_URL,
  SLACK_SIGNING_SECRET,
  SLACK_STATE_SECRET,
} from "@carbon/auth";

export const slackAuthResponseSchema = z.object({
  ok: z.literal(true),
  app_id: z.string(),
  authed_user: z.object({
    id: z.string(),
  }),
  code: z.string(),
  scope: z.string(),
  token_type: z.literal("bot"),
  access_token: z.string(),
  bot_user_id: z.string(),
  team: z.object({
    id: z.string(),
    name: z.string(),
  }),
  incoming_webhook: z.object({
    channel: z.string(),
    channel_id: z.string(),
    configuration_url: z.string().url(),
    url: z.string().url(),
  }),
  state: z.any(),
});

let slackInstaller: InstallProvider | null = null;

export const createSlackApp = ({
  token,
  botId,
}: {
  token: string;
  botId: string;
}) => {
  return new SlackApp({
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
        process.env.NODE_ENV === "development" ? LogLevel.DEBUG : undefined,
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
