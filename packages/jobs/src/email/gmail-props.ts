// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SendEmailPayload } from "@carbon/lib/email.server";

export type GmailAttachment = { filename: string; base64: string };

const list = (value: string | string[] | undefined) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/**
 * The Activepieces `gmail_send_email` props for one message. The piece builds
 * the MIME itself and sends as the connected account, so `from` stays unset:
 * the piece reads the account's address from Google.
 */
export function gmailSendProps(
  payload: Omit<SendEmailPayload, "from" | "attachments">,
  senderName: string,
  attachments: GmailAttachment[]
): Record<string, unknown> {
  const replyTo = payload.replyTo
    ?.split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  return {
    receiver: list(payload.to),
    ...(payload.cc !== undefined && { cc: list(payload.cc) }),
    ...(payload.bcc !== undefined && { bcc: list(payload.bcc) }),
    subject: payload.subject,
    // The piece sends ONE body part: html when there is html, else the text.
    body_type: payload.html ? "html" : "plain_text",
    body: payload.html ?? payload.text ?? "",
    ...(replyTo?.length && { reply_to: replyTo }),
    sender_name: senderName,
    attachments: attachments.map(({ filename, base64 }) => ({
      file: {
        filename,
        base64,
        extension: filename.includes(".")
          ? filename.slice(filename.lastIndexOf(".") + 1)
          : ""
      }
    })),
    draft: false
  };
}
