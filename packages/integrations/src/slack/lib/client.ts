import { LogLevel, App as SlackApp } from "@slack/bolt";
import { InstallProvider } from "@slack/oauth";
import { WebClient } from "@slack/web-api";

import {
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_OAUTH_REDIRECT_URL,
  SLACK_SIGNING_SECRET,
  SLACK_STATE_SECRET,
} from "@carbon/auth";

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

export const getInstallUrl = ({
  teamId,
  userId,
}: {
  teamId: string;
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
    metadata: JSON.stringify({ teamId, userId }),
  });
};
