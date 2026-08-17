/**
 * Stripe Connect Webhook Handler
 *
 * Receives events raised on CONNECTED accounts (Stripe delivers these to an
 * endpoint registered with `connect: true`, signed with its own secret and
 * carrying `event.account`). Separate from `/api/webhook/stripe`, which handles
 * Carbon's own billing subscription on the platform account.
 *
 * Handled today:
 * - `invoice.paid` / `invoice.payment_succeeded` — record and post a Carbon
 *   payment against the originating sales invoice, and book Stripe's fee.
 * - `invoice.payment_failed` / `invoice.marked_uncollectible` — logged only; no
 *   ledger change, since nothing was collected.
 *
 * Anything else is acknowledged with 200 so Stripe stops retrying it. Non-2xx is
 * reserved for a failed signature check and for genuinely retryable failures.
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { recordStripeConnectPayment } from "@carbon/ee/stripe-connect.server";
import { getLogger } from "@carbon/logger";
import type { ConnectInvoice } from "@carbon/stripe/connect.server";
import { constructConnectWebhookEvent } from "@carbon/stripe/connect.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "webhook", "stripe-connect");

async function getCompanyForConnectAccount(stripeAccountId: string) {
  const serviceRole = getCarbonServiceRole();

  const integration = await serviceRole
    .from("companyIntegration")
    .select("companyId, active, metadata")
    .eq("id", "stripe-connect")
    .eq("metadata->>stripeAccountId", stripeAccountId)
    .maybeSingle();

  if (integration.error || !integration.data) return null;

  return {
    companyId: integration.data.companyId,
    active: integration.data.active,
    metadata: (integration.data.metadata ?? {}) as Record<string, unknown>
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    logger.error("No signature");
    return data({ error: "No signature" }, { status: 400 });
  }

  const verified = constructConnectWebhookEvent({ body, signature });
  if (!verified.success) {
    logger.error("Stripe Connect webhook signature verification failed", {
      error: verified.error
    });
    return data({ error: "Invalid signature" }, { status: 400 });
  }

  const event = verified.event;

  // Platform-account events belong on /api/webhook/stripe. Acknowledge rather
  // than error so a misrouted event doesn't retry forever.
  if (!event.account) {
    logger.warn("Ignoring Stripe Connect event with no connected account", {
      type: event.type,
      eventId: event.id
    });
    return { success: true };
  }

  const company = await getCompanyForConnectAccount(event.account);
  if (!company) {
    logger.warn("No company is connected to this Stripe account", {
      type: event.type,
      eventId: event.id,
      stripeAccountId: event.account
    });
    return { success: true };
  }

  if (!company.active) {
    logger.warn("Stripe Connect integration is inactive for this company", {
      type: event.type,
      companyId: company.companyId
    });
    return { success: true };
  }

  try {
    switch (event.type) {
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as ConnectInvoice;

        // The send path stamps the company on the Stripe invoice. When it's
        // there it must agree with the account→company lookup; a mismatch is a
        // cross-tenant write we refuse outright.
        const invoiceCompanyId = invoice.metadata?.companyId;
        if (invoiceCompanyId && invoiceCompanyId !== company.companyId) {
          logger.error("Stripe invoice company does not match its account", {
            eventId: event.id,
            stripeAccountId: event.account,
            invoiceCompanyId,
            companyId: company.companyId
          });
          return data({ error: "Company mismatch" }, { status: 400 });
        }

        const result = await recordStripeConnectPayment({
          companyId: company.companyId,
          stripeAccountId: event.account,
          integrationMetadata: company.metadata,
          stripeInvoice: invoice
        });

        if (result.status === "skipped") {
          logger.info("Stripe Connect payment not recorded", {
            eventId: event.id,
            companyId: company.companyId,
            reason: result.reason
          });
        } else {
          logger.info("Recorded Stripe Connect payment", {
            eventId: event.id,
            companyId: company.companyId,
            paymentId: result.paymentId
          });
        }
        break;
      }

      case "invoice.payment_failed":
      case "invoice.marked_uncollectible": {
        const invoice = event.data.object as ConnectInvoice;
        logger.warn("Stripe Connect invoice was not collected", {
          type: event.type,
          companyId: company.companyId,
          stripeInvoiceId: invoice.id,
          carbonInvoiceId: invoice.metadata?.carbonInvoiceId
        });
        break;
      }

      default:
        logger.info("Unhandled Stripe Connect event", {
          type: event.type,
          eventId: event.id,
          companyId: company.companyId
        });
    }

    return { success: true };
  } catch (error) {
    // 500 so Stripe retries — the failures that reach here are the fixable
    // configuration ones (missing bank account, missing sequence).
    logger.error("Stripe Connect webhook error", {
      error,
      type: event.type,
      eventId: event.id,
      companyId: company.companyId
    });
    return data({ error: "Webhook processing failed" }, { status: 500 });
  }
}
