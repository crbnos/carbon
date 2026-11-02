// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHmac } from "node:crypto";
import { SLACK_SIGNING_SECRET } from "@carbon/auth";
import Bolt from "@slack/bolt";
import { WebClient } from "@slack/web-api";

const { App } = Bolt;

export const createSlackApp = ({
  token,
  botId
}: {
  token: string;
  botId: string;
}) => {
  return new App({
    signingSecret: SLACK_SIGNING_SECRET,
    token,
    botId
  });
};

export const createSlackWebClient = ({ token }: { token: string }) => {
  return new WebClient(token);
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
 * Tell the channel picked during install that the bot is live there, so the
 * person who installed it can see it worked.
 */
export async function postSlackWelcome({
  token,
  channelId
}: {
  token: string;
  channelId: string;
}) {
  const client = createSlackWebClient({ token });
  const text =
    "Ahoy maties! 🦜🏴‍☠️ Here be your new Cargh-bon bot. Use `/` to get started.";

  return client.chat.postMessage({
    channel: channelId,
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
    unfurl_links: false,
    unfurl_media: false
  });
}

/**
 * Post a message to a Slack thread
 */
export async function postToSlackThread({
  token,
  channelId,
  threadTs,
  blocks,
  text
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
    unfurl_media: false
  });
}

/**
 * Create a new Slack thread
 */
export async function createSlackThread({
  token,
  channelId,
  blocks,
  text
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
    unfurl_media: false
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
  text
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
    text: text || "Updated message from Carbon"
  });
}

/**
 * Get thread replies from Slack
 */
export async function getSlackThreadReplies({
  token,
  channelId,
  threadTs,
  limit = 100
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
    limit
  });
}
