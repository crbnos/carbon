// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  SendEmailPayload,
  SendEmailResult
} from "@carbon/lib/email.server";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isRateLimitedResponse,
  NOT_SENT
} from "../inngest/functions/notifications/delivery-failure";
import { buildPieceContext } from "../workflows/integrations/context";
import { resolvePieceAuth } from "../workflows/integrations/piece-auth";
import { getPieceAction } from "../workflows/integrations/registry";
import { type GmailAttachment, gmailSendProps } from "./gmail-props";

const log = getLogger("jobs", "gmail-email");

// The Gmail piece's name (`Gmail.id`). Named here rather than imported: the
// Gmail descriptor reads the server env through `@carbon/auth` at import.
const GMAIL_PIECE = "gmail";
const SEND_ACTION = "gmail_send_email";

// Every auth failure stops before Google; only these can clear on their own
// (another caller's refresh, a brief outage at Google's token endpoint).
const RETRYABLE_AUTH_REASONS = new Set(["refreshing", "failed"]);

const notSent = (message: string, retryable = false) =>
  Object.assign(
    new Error(message),
    retryable ? { code: NOT_SENT } : {}
  ) as Error;

/** A `path` attachment is fetched. */
async function readAttachments(
  attachments: SendEmailPayload["attachments"]
): Promise<GmailAttachment[]> {
  return Promise.all(
    (attachments ?? []).map(async (attachment) => {
      if ("content" in attachment) {
        return { filename: attachment.filename, base64: attachment.content };
      }
      const response = await fetch(attachment.path);
      if (!response.ok) {
        throw new Error(
          `Could not read the attachment ${attachment.filename} (${response.status})`
        );
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        filename: attachment.filename,
        base64: bytes.toString("base64")
      };
    })
  );
}

/**
 * Sends one message as a company's connected Gmail account, through the
 * Activepieces Gmail piece — the same token path and context as a workflow
 * step (`runIntegrationAction`). Never throws: a failure is the `error` of the
 * result, with `code: ENOTSENT` only when nothing could have reached Google.
 */
export async function sendViaGmail(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string,
  senderName: string,
  payload: Omit<SendEmailPayload, "from">
): Promise<SendEmailResult> {
  const auth = await resolvePieceAuth(
    serviceClient,
    companyId,
    GMAIL_PIECE,
    connectionId
  );
  if (!auth.ok) {
    log.error("Gmail cannot send for this company", {
      companyId,
      connectionId,
      reason: auth.reason,
      cause: "cause" in auth ? auth.cause : undefined
    });
    return {
      data: null,
      error: notSent(
        `Gmail cannot send: ${auth.reason}`,
        RETRYABLE_AUTH_REASONS.has(auth.reason)
      )
    };
  }

  let attachments: GmailAttachment[];
  try {
    attachments = await readAttachments(payload.attachments);
  } catch (error) {
    // A signed URL that failed to download: nothing was sent, so retry.
    log.error("Gmail could not read an attachment", { companyId, error });
    return {
      data: null,
      error: notSent(
        error instanceof Error ? error.message : String(error),
        true
      )
    };
  }

  let propsValue: Record<string, unknown>;
  let action: Awaited<ReturnType<typeof getPieceAction>>;
  try {
    propsValue = gmailSendProps(payload, senderName, attachments);
    action = await getPieceAction(GMAIL_PIECE, SEND_ACTION);
  } catch (error) {
    // Ours, before any Google call: nothing was sent, and a retry fails the same way.
    log.error("Gmail send could not start", { companyId, error });
    return { data: null, error: error as Error };
  }

  try {
    const result = (await action.run(
      buildPieceContext({
        auth: { access_token: auth.accessToken },
        propsValue
      })
    )) as { data?: { id?: string | null } } | undefined;
    return { data: { id: result?.data?.id ?? "gmail" }, error: null };
  } catch (error) {
    log.error("Gmail rejected the email", {
      companyId,
      subject: payload.subject,
      error
    });
    // Any other vendor error may have sent the message: never replay it.
    return {
      data: null,
      error: isRateLimitedResponse(error)
        ? notSent(
            `Gmail rate limited the send: ${(error as Error).message}`,
            true
          )
        : (error as Error)
    };
  }
}
