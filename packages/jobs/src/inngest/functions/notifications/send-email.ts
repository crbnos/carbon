// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { documentSender, resolveEmailDelivery } from "@carbon/ee";
import {
  DEFAULT_FROM,
  SERVER_MAIL_CONFIGURED,
  sendEmail
} from "@carbon/lib/email.server";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import { emailDeliveryFailure } from "./delivery-failure";

export const sendEmailFunction = inngest.createFunction(
  {
    id: "send-email",
    retries: 3
  },
  { event: "carbon/send-email" },
  async ({ event, step, logger }) => {
    const payload = event.data;

    // The mail transport rejects `to` or `cc` lists containing null/undefined
    // entries, so strip falsy values regardless of what callers pass.
    const sanitizeRecipients = (
      value: string | string[] | undefined
    ): string | string[] | undefined => {
      if (Array.isArray(value)) {
        const filtered = value.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.length > 0
        );
        return filtered.length ? filtered : undefined;
      }
      return value && typeof value === "string" ? value : undefined;
    };

    const toRecipients = sanitizeRecipients(payload.to);
    const ccRecipients = sanitizeRecipients(payload.cc);

    if (!toRecipients) {
      throw new NonRetriableError(
        "send-email called without any valid `to` recipients"
      );
    }

    const result = await step.run("send-email", async () => {
      logger.info("Email Job");
      // Only document emails follow the company's Email settings; sign-in,
      // security and notification mail always goes from the server's address.
      let sender: ReturnType<typeof documentSender> = {};
      if (payload.document && payload.companyId) {
        const client = getCarbonServiceRole();
        const integration = await client
          .from("companyIntegration")
          .select("active, metadata")
          .eq("id", "email")
          .eq("companyId", payload.companyId)
          .maybeSingle();
        if (integration.error) {
          logger.error("Failed to read the company's Email integration", {
            companyId: payload.companyId,
            error: integration.error
          });
          throw integration.error;
        }
        const delivery = resolveEmailDelivery(
          integration.data,
          SERVER_MAIL_CONFIGURED
        );
        if (delivery?.provider === "server") {
          const company = await client
            .from("company")
            .select("name")
            .eq("id", payload.companyId)
            .maybeSingle();
          if (company.error) {
            logger.error("Failed to read the company's name", {
              companyId: payload.companyId,
              error: company.error
            });
            throw company.error;
          }
          sender = documentSender(delivery, company.data?.name, DEFAULT_FROM);
        }
      }
      // Replies reach the person who sent the document and the company's
      // address, which server mail never sends from.
      const replyTo = [...new Set([payload.from, sender.replyTo])]
        .filter(Boolean)
        .join(", ");
      const response = await sendEmail({
        from: sender.from,
        attachments: payload.attachments,
        cc: ccRecipients,
        html: payload.html,
        replyTo: replyTo || undefined,
        subject: payload.subject,
        text: payload.text,
        to: toRecipients
      });
      // Retry only what provably never reached the relay; everything else is
      // terminal, because a replay of an ambiguous failure is how one click
      // becomes three copies in the customer's inbox.
      if (response.error) throw emailDeliveryFailure(response.error);
      // data is null when SMTP is not configured — email is disabled.
      return response.data;
    });

    // Count the delivery for recurring notifications (result is null when
    // email is disabled). Throwing here is retry-safe: the memoized send step
    // won't re-send, and the memoized message id makes the increment idempotent.
    const tracking = payload.tracking;
    if (tracking && result) {
      await step.run("record-delivery", async () => {
        const client = getCarbonServiceRole();
        const { error } = await client.rpc("increment_notification_delivery", {
          p_company_id: payload.companyId,
          p_delivery_id: result.id,
          p_document_ids: tracking.documentIds,
          p_event: tracking.event,
          p_user_id: tracking.userId
        });
        if (error) {
          console.error("Failed to record notification delivery", error);
          throw error;
        }
      });
    }

    return { result, success: true };
  }
);
