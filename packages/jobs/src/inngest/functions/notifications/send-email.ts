import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { sendEmail } from "@carbon/lib/email.server";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";

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
      const response = await sendEmail({
        attachments: payload.attachments,
        cc: ccRecipients,
        html: payload.html,
        replyTo: payload.from,
        subject: payload.subject,
        text: payload.text,
        to: toRecipients
      });
      if (response.error) {
        throw new Error(`Email error: ${response.error.message}`);
      }
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
