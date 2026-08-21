import { createHmac, timingSafeEqual } from "node:crypto";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildQboPaymentSyncChange,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  parseStoredCredentials
} from "@carbon/ee/accounting";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

// Needs node:crypto for HMAC signature verification + a QBO API refetch
export const config = { runtime: "nodejs" };

const logger = getLogger("erp", "webhook-quickbooks");

/**
 * Intuit webhook payload. NOTIFICATION-ONLY: each entity carries just
 * `{ name, id, operation, lastUpdated }` — no object body — so the payment op
 * is enqueued and its `fetchRemote` pulls the object. Lenient: only the fields
 * the route reads are required; Intuit may add fields at any time.
 */
const webhookValidator = z
  .object({
    eventNotifications: z
      .array(
        z
          .object({
            realmId: z.string().optional(),
            dataChangeEvent: z
              .object({
                entities: z
                  .array(
                    z
                      .object({
                        name: z.string(),
                        id: z.string(),
                        operation: z.string().optional(),
                        lastUpdated: z.string().optional()
                      })
                      .passthrough()
                  )
                  .default([])
              })
              .passthrough()
              .optional()
          })
          .passthrough()
      )
      .default([])
  })
  .passthrough();

/** Payment entity names Carbon acts on; every other name is acked + ignored. */
const PAYMENT_ENTITY_NAMES = new Set(["Payment", "BillPayment"]);

/** Health-check endpoint for the URL pasted into Intuit's webhook form. */
export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.companyId) {
    return data({ success: false }, { status: 400 });
  }
  return { success: true };
}

/**
 * Constant-time compare of the base64 `intuit-signature` header against the
 * expected HMAC. Length mismatch fails fast (timingSafeEqual throws on unequal
 * buffer lengths).
 */
function signaturesMatch(headerValue: string, expected: string): boolean {
  const a = Buffer.from(headerValue, "base64");
  const b = Buffer.from(expected, "base64");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export async function action({ request, params }: ActionFunctionArgs) {
  // CORS preflight short-circuit (webhooks are server-to-server, but ack it).
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, intuit-signature"
      }
    });
  }

  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  // Raw body FIRST — the Intuit signature covers the exact bytes, not
  // re-serialized JSON.
  const body = await request.text();

  const serviceRole = getCarbonServiceRole();

  const integration = await getAccountingIntegration(
    serviceRole,
    companyId,
    ProviderID.QUICKBOOKS
  ).catch(() => null);
  if (!integration || !integration.active) {
    return data({ success: false }, { status: 404 });
  }

  // Intuit signs webhooks with the app's "verifier token" (base64
  // HMAC-SHA256 of the raw body). VERIFY: it currently lives on the QBO
  // credentials as providerMetadata.webhookVerifierToken (per-company), with an
  // env fallback for a single app-wide token — confirm where Carbon persists
  // it during QBO setup and drop whichever branch is unused.
  let verifierToken: string | null = null;
  try {
    const credentials = parseStoredCredentials(
      integration.metadata.credentials
    );
    if (credentials.type === "oauth2") {
      const token = credentials.providerMetadata?.webhookVerifierToken;
      if (typeof token === "string" && token.length > 0) {
        verifierToken = token;
      }
    }
  } catch (error) {
    logger.error("Failed to parse stored QuickBooks Online credentials", {
      error
    });
  }
  if (!verifierToken) {
    const envToken = process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN;
    if (typeof envToken === "string" && envToken.length > 0) {
      verifierToken = envToken;
    }
  }
  if (!verifierToken) {
    return data(
      { success: false, error: "Webhook verifier token not configured" },
      { status: 401 }
    );
  }

  const signature = request.headers.get("intuit-signature");
  if (!signature) {
    return data({ success: false }, { status: 401 });
  }

  const expected = createHmac("sha256", verifierToken)
    .update(body)
    .digest("base64");
  if (!signaturesMatch(signature, expected)) {
    return data({ success: false }, { status: 401 });
  }

  let parsed: z.infer<typeof webhookValidator>;
  try {
    parsed = webhookValidator.parse(JSON.parse(body));
  } catch (error) {
    logger.error("Invalid QuickBooks Online webhook payload", { error });
    return data({ success: false }, { status: 400 });
  }

  // Forward-compatibility: unrecognized entity names are acknowledged and
  // ignored, never rejected.
  const paymentNotifications = parsed.eventNotifications
    .flatMap((notification) => notification.dataChangeEvent?.entities ?? [])
    .filter((entity) => PAYMENT_ENTITY_NAMES.has(entity.name));

  if (paymentNotifications.length === 0) {
    return { success: true, ignored: true };
  }

  // The notification is object-less, so refetch each payment to resolve its
  // settled document and build the CANONICAL composite id — the same id the
  // CDC sweep emits, so webhook + sweep dedupe on the one `payment` mapping
  // (ledger idempotency). The CDC sweep is the correctness backstop.
  const provider = getProviderIntegration(
    serviceRole,
    companyId,
    ProviderID.QUICKBOOKS,
    integration.metadata
  );

  const entities: Array<{
    entityType: "payment";
    entityId: string;
    operation: "update";
  }> = [];

  for (const notification of paymentNotifications) {
    const family = notification.name === "BillPayment" ? "ap" : "ar";
    try {
      const remote =
        family === "ap"
          ? await provider.getBillPayment(notification.id)
          : await provider.getPayment(notification.id);
      if (!remote) {
        logger.info("QuickBooks Online payment not found on refetch", {
          companyId,
          name: notification.name,
          id: notification.id
        });
        continue;
      }

      const change = buildQboPaymentSyncChange(remote, family);
      if (!change) {
        logger.info("QuickBooks Online payment settles no Bill/Invoice", {
          companyId,
          name: notification.name,
          id: notification.id
        });
        continue;
      }

      entities.push({
        entityType: "payment",
        entityId: change.entityId,
        operation: "update"
      });
    } catch (error) {
      logger.error("Failed to resolve QuickBooks Online payment", {
        companyId,
        name: notification.name,
        id: notification.id,
        error
      });
    }
  }

  if (entities.length === 0) {
    return { success: true, ignored: true };
  }

  await trigger("sync-external-accounting", {
    companyId,
    provider: ProviderID.QUICKBOOKS,
    syncType: "webhook",
    syncDirection: "pull-from-accounting",
    entities,
    metadata: { raw: parsed }
  });

  logger.info("Triggered QuickBooks Online payment sync", {
    companyId,
    count: entities.length
  });

  return { success: true };
}
