// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Email } from "@carbon/ee/email/delivery";
import { redis } from "@carbon/kv";
import { trigger } from "@carbon/lib/trigger";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";

const log = getLogger("jobs", "gmail-sending-limit");

// Gmail's sending limit resets within a day; one notice per day is enough.
const NOTIFY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Tells whoever last saved the Email settings that Gmail's sending limit is
 * blocking the company's email, at most once a day. In-app only: email is the
 * channel that is failing. Never throws, so the send's outcome stays the same.
 */
export async function notifyGmailSendingLimit(
  companyId: string,
  recipientId: string | null | undefined
): Promise<void> {
  if (!recipientId || recipientId === "system") return;
  try {
    const first = await redis.set(
      `integrations:${companyId}:${Email.id}:gmail-sending-limit`,
      "1",
      "EX",
      NOTIFY_TTL_SECONDS,
      "NX"
    );
    if (first !== "OK") return;
    await trigger("notify", {
      event: NotificationEvent.IntegrationSync,
      companyId,
      documentId: Email.id,
      title: "Gmail's daily sending limit is reached",
      body: "Your company's emails are failing until Google resets the limit, within 24 hours. This includes quotes, invoices, purchase orders and notifications. To keep sending, pick another delivery method in the Email settings.",
      recipient: { type: "user", userId: recipientId }
    });
  } catch (error) {
    log.error("Failed to send the Gmail sending-limit notice", {
      companyId,
      error
    });
  }
}
