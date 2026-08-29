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
 * - `charge.refunded` (full only), `charge.dispute.closed` (status "lost"),
 *   `invoice.voided` — void the Carbon payment via `voidStripeConnectPayment`,
 *   a full reversal. A PARTIAL refund has no safe automated GL treatment (no
 *   partial-reversal journal capability exists) and is logged, not acted on.
 * - `account.updated` — refresh `chargesEnabled`/`payoutsEnabled`/requirement
 *   errors on the integration, the same way `callback.ts` does after
 *   onboarding. NOTE: Carbon creates Connect accounts via Stripe's v2 Core
 *   Accounts API, while this endpoint is a classic v1 webhook — whether
 *   Stripe delivers a v1 `account.updated` for a v2-created account has not
 *   been verified against a live test event; treat this case as best-effort
 *   until confirmed.
 *
 * Anything else is acknowledged with 200 so Stripe stops retrying it. Non-2xx is
 * reserved for a failed signature check and for genuinely retryable failures.
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getStripeInvoiceIdForCharge,
  recordStripeConnectPayment,
  voidStripeConnectPayment
} from "@carbon/ee/stripe-connect.server";
import { getLogger } from "@carbon/logger";
import type {
  ConnectCharge,
  ConnectDispute,
  ConnectInvoice
} from "@carbon/stripe/connect.server";
import {
  constructConnectWebhookEvent,
  getConnectAccountStatus
} from "@carbon/stripe/connect.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "webhook", "stripe-connect");
// Matches the SYSTEM_USER convention in payment.server.ts — this handler has
// no real user, but upsertCompanyIntegration requires an updatedBy audit value.
const SYSTEM_UPDATED_BY = "system";

async function getCompanyForConnectAccount(stripeAccountId: string) {
  const serviceRole = getCarbonServiceRole();

  const integration = await serviceRole
    .from("companyIntegration")
    .select("companyId, active, metadata")
    .eq("id", "stripe-connect")
    .eq("metadata->>stripeAccountId", stripeAccountId)
    .maybeSingle();

  if (integration.error) {
    // Includes the ambiguous case where more than one company claims this
    // account, which maybeSingle() also reports as an error.
    return { error: integration.error };
  }
  if (!integration.data) return { error: null, company: null };

  return {
    error: null,
    company: {
      companyId: integration.data.companyId,
      active: integration.data.active,
      metadata: (integration.data.metadata ?? {}) as Record<string, unknown>
    }
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

  const lookup = await getCompanyForConnectAccount(event.account);
  if (lookup.error) {
    logger.error("Failed to resolve the company for this Stripe account", {
      error: lookup.error,
      eventId: event.id,
      stripeAccountId: event.account
    });
    return data({ error: "Company lookup failed" }, { status: 500 });
  }

  const company = lookup.company;
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

      case "invoice.voided": {
        const invoice = event.data.object as ConnectInvoice;
        const result = await voidStripeConnectPayment({
          companyId: company.companyId,
          stripeInvoiceId: invoice.id
        });
        logger.info("Stripe Connect invoice voided", {
          eventId: event.id,
          companyId: company.companyId,
          stripeInvoiceId: invoice.id,
          result
        });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as ConnectCharge;
        // Stripe's pinned API version dropped Charge.invoice — resolve via
        // Carbon's own mapping metadata instead (see
        // getStripeInvoiceIdForCharge).
        const stripeInvoiceId = await getStripeInvoiceIdForCharge(
          company.companyId,
          charge.id
        );

        if (!stripeInvoiceId) {
          logger.warn("Refunded charge has no invoice to trace", {
            eventId: event.id,
            companyId: company.companyId,
            chargeId: charge.id
          });
          break;
        }

        if (!charge.refunded) {
          // Partial refund — Stripe only sets `refunded: true` once the FULL
          // charge amount has been returned. There is no partial-reversal
          // journal capability, so this is surfaced for manual handling
          // rather than voiding the whole payment.
          logger.warn(
            "Partial Stripe Connect refund — no automated GL reversal, needs manual handling",
            {
              eventId: event.id,
              companyId: company.companyId,
              chargeId: charge.id,
              stripeInvoiceId,
              amountRefunded: charge.amount_refunded,
              amountCaptured: charge.amount_captured
            }
          );
          break;
        }

        const result = await voidStripeConnectPayment({
          companyId: company.companyId,
          stripeInvoiceId
        });
        logger.info("Stripe Connect payment voided for a full refund", {
          eventId: event.id,
          companyId: company.companyId,
          stripeInvoiceId,
          result
        });
        break;
      }

      case "charge.dispute.closed": {
        const dispute = event.data.object as ConnectDispute;
        if (dispute.status !== "lost") {
          // won / warning_* / needs_response — no funds actually changed
          // hands yet, nothing to reverse.
          logger.info("Stripe Connect dispute closed without a loss", {
            eventId: event.id,
            companyId: company.companyId,
            disputeId: dispute.id,
            status: dispute.status
          });
          break;
        }

        const chargeId =
          typeof dispute.charge === "string"
            ? dispute.charge
            : dispute.charge.id;
        const stripeInvoiceId = await getStripeInvoiceIdForCharge(
          company.companyId,
          chargeId
        );

        if (!stripeInvoiceId) {
          logger.warn("Lost dispute has no traceable invoice", {
            eventId: event.id,
            companyId: company.companyId,
            disputeId: dispute.id,
            chargeId
          });
          break;
        }

        const result = await voidStripeConnectPayment({
          companyId: company.companyId,
          stripeInvoiceId
        });
        logger.info("Stripe Connect payment voided for a lost dispute", {
          eventId: event.id,
          companyId: company.companyId,
          stripeInvoiceId,
          result
        });
        break;
      }

      case "account.updated": {
        const accountStatus = await getConnectAccountStatus(event.account);
        if (accountStatus) {
          await upsertCompanyIntegration(getCarbonServiceRole(), {
            id: "stripe-connect",
            companyId: company.companyId,
            active: true,
            metadata: { ...company.metadata, ...accountStatus },
            updatedBy: SYSTEM_UPDATED_BY
          });
          logger.info("Refreshed Stripe Connect account status", {
            eventId: event.id,
            companyId: company.companyId,
            chargesEnabled: accountStatus.chargesEnabled,
            payoutsEnabled: accountStatus.payoutsEnabled
          });
        }
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
