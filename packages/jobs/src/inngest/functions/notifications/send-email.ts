import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { RESEND_DOMAIN } from "@carbon/env";
import { NonRetriableError, serializeError } from "inngest";
import { Resend } from "resend";
import { inngest } from "../../client";

export const sendEmailFunction = inngest.createFunction(
  {
    id: "send-email",
    retries: 3
  },
  { event: "carbon/send-email" },
  async ({ event, step, logger }) => {
    const payload = event.data;

    // Resend rejects the request if `to` or `cc` contain null/undefined
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

    const fromAddress = `Carbon <no-reply@${RESEND_DOMAIN}>`;

    const result = await step.run("send-email", async () => {
      if (process.env.DISABLE_RESEND) {
        logger.info("Resend disabled — skipping send", { toRecipients });
        return null;
      }

      const resend = new Resend(process.env.RESEND_API_KEY!);

      const email = {
        attachments: payload.attachments,
        cc: ccRecipients,
        from: fromAddress,
        html: payload.html,
        reply_to: payload.from,
        subject: payload.subject,
        text: payload.text,
        to: toRecipients
      };

      logger.info("Resend Email Job");
      const response = await resend.emails.send(email);
      if (response.error) {
        if (response.error.name === "validation_error") {
          throw new NonRetriableError(
            `Resend validation error: ${serializeError(response.error)}`
          );
        }
        throw new Error(`Resend error: ${serializeError(response.error)}`);
      }
      return response.data;
    });

    // Count the delivery for recurring notifications (result is null when
    // Resend is disabled). Throwing here is retry-safe: the memoized send step
    // won't re-send, and the memoized Resend id makes the increment idempotent.
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
