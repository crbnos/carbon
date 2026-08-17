import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getRilletPaymentSyncEntityId,
  ProviderID,
  parseStoredCredentials,
  verifyRilletWebhookSignature
} from "@carbon/ee/accounting";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getIntegration } from "~/modules/settings/settings.service";

// Needs node:crypto for constant-time HMAC comparison
export const config = { runtime: "nodejs" };

const logger = getLogger("erp", "webhook-rillet");

/**
 * Rillet invoice-payment payload. Lenient: only the ids the sync needs are
 * required; Rillet may add fields at any time.
 */
const paymentPayloadValidator = z
  .object({
    id: z.string().min(1),
    invoice_id: z.string().min(1)
  })
  .passthrough();

/** Health-check endpoint for the URL pasted into Rillet's webhook form. */
export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.companyId) {
    return data({ success: false }, { status: 400 });
  }
  return { success: true };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  // Raw body FIRST — the signature covers the exact bytes, not re-serialized
  // JSON.
  const body = await request.text();

  const serviceRole = getCarbonServiceRole();
  const integration = await getIntegration(serviceRole, "rillet", companyId);
  if (integration.error || !integration.data || !integration.data.active) {
    return data({ success: false }, { status: 404 });
  }

  // The per-webhook token lives with the API-key credentials. No token =
  // payments not enabled — reject rather than fail open.
  const metadata = (integration.data.metadata ?? {}) as Record<string, unknown>;
  let webhookToken: string | null = null;
  try {
    const credentials = parseStoredCredentials(metadata.credentials);
    if (
      credentials.type === "apiKey" &&
      typeof credentials.providerMetadata?.webhookToken === "string" &&
      credentials.providerMetadata.webhookToken.length > 0
    ) {
      webhookToken = credentials.providerMetadata.webhookToken;
    }
  } catch (error) {
    logger.error("Failed to parse stored Rillet credentials", { error });
  }
  if (!webhookToken) {
    return data(
      { success: false, error: "Webhook token not configured" },
      { status: 401 }
    );
  }

  const signature = request.headers.get("x-rillet-signature");
  const timestamp = request.headers.get("x-rillet-timestamp");
  const deliveryId = request.headers.get("x-rillet-id");
  const entity = request.headers.get("x-rillet-entity");
  const event = request.headers.get("x-rillet-event");

  if (!signature || !timestamp || !deliveryId || !entity || !event) {
    return data({ success: false }, { status: 401 });
  }

  const verified = verifyRilletWebhookSignature({
    headers: { signature, timestamp, id: deliveryId, entity, event },
    body,
    token: webhookToken
  });
  if (!verified) {
    return data({ success: false }, { status: 401 });
  }

  // VERIFY(Phase 1.3): AP bill payments are POLL-ONLY. Rillet documents only
  // `bill-created`/`bill-updated`/`bill-deleted` webhook events — no
  // bill-payment (or bill-updated-on-payment) event is confirmed — so this
  // route stays AR-only and the accounting-pull-sweep (RilletProvider.listChanges
  // over /bill-payments) is the guarantee for AP settlement. If a
  // bill-updated-on-payment event is later confirmed, branch here and enqueue a
  // `bill:` composite-id `payment` op via getRilletBillPaymentSyncEntityId.
  //
  // Forward-compatibility contract: unrecognized entity/event values are
  // acknowledged and ignored, never rejected.
  const isInvoicePayment =
    entity.toLowerCase() === "invoice" &&
    event.toLowerCase() === "payment-updated";
  if (!isInvoicePayment) {
    return { success: true, ignored: true };
  }

  let parsed: z.infer<typeof paymentPayloadValidator>;
  try {
    parsed = paymentPayloadValidator.parse(JSON.parse(body));
  } catch (error) {
    logger.error("Invalid Rillet payment webhook payload", { error });
    return data({ success: false }, { status: 400 });
  }

  // Ack fast; the sync job enqueues to the ledger and drains. The composite
  // entity id makes the payment syncer self-sufficient (invoice + payment
  // remote ids), so no metadata threading is required.
  await trigger("sync-external-accounting", {
    companyId,
    provider: ProviderID.RILLET,
    syncType: "webhook",
    syncDirection: "pull-from-accounting",
    entities: [
      {
        entityType: "payment",
        entityId: getRilletPaymentSyncEntityId(parsed.invoice_id, parsed.id),
        operation: "update"
      }
    ],
    metadata: { deliveryId, raw: parsed }
  });

  logger.info("Triggered Rillet payment sync", {
    companyId,
    deliveryId,
    paymentId: parsed.id
  });

  return { success: true };
}
