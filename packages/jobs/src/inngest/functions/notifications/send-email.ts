import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { sendEmail } from "@carbon/lib/email.server";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";

/**
 * Nodemailer codes raised while connecting, greeting or authenticating — before
 * a single recipient or byte of DATA is sent. A failure here provably delivered
 * nothing, so replaying it is safe.
 *
 * Everything else is treated as ambiguous and terminal, including `ETIMEDOUT`
 * and `ESOCKET`: nodemailer raises those at ANY phase, so one of them can mean
 * the relay accepted the message and then dropped the connection before the
 * final ack. Retrying that is how one send becomes three copies in a customer's
 * inbox. An SMTP send carries no idempotency key, so "did that land?" is not a
 * question we can ask — a missed email is recoverable by re-sending, a
 * duplicated one is not.
 */
const RETRYABLE_SMTP_CODES = new Set(["ECONNECTION", "EDNS", "EAUTH", "ETLS"]);

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
        const code = (response.error as { code?: string }).code;
        if (code && RETRYABLE_SMTP_CODES.has(code)) {
          // Nothing was handed to the relay — let Inngest retry.
          throw new Error(`Email error (${code}): ${response.error.message}`);
        }
        // Everything else is terminal, either because it is deterministic (a
        // rejected envelope never succeeds on retry) or because delivery is
        // ambiguous and a retry risks a duplicate. Fail loud, send once.
        throw new NonRetriableError(
          `Email error${code ? ` (${code})` : ""}: ${response.error.message}`
        );
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
