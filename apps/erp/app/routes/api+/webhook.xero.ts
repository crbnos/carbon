/**
 * Xero Webhook Handler
 *
 * This endpoint receives webhook notifications from Xero when entities
 * (contacts, invoices, etc.) are created, updated, or deleted in Xero.
 *
 * The webhook handler implements Xero's intent-to-receive workflow:
 * 1. Validates the webhook signature for security
 * 2. Returns HTTP 200 for valid signatures (intent-to-receive)
 * 3. Once Xero confirms the webhook is working, processes actual events
 * 4. Looks up the company integration by Xero tenant ID
 * 5. Triggers background sync jobs to process the entity changes
 *
 * Supported entity types:
 * - Contact: Synced to Carbon's customer/supplier table (based on IsCustomer/IsSupplier flags)
 * - Invoice: Synced to Carbon's invoice table
 *
 * The actual sync logic is handled asynchronously by the accounting-sync
 * background job to prevent webhook timeouts and ensure reliability.
 */

import { XERO_WEBHOOK_SECRET } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type {
  AccountingEntity,
  AccountingProvider,
  AccountingSyncPayload
} from "@carbon/ee/accounting";
import {
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID
} from "@carbon/ee/accounting";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import crypto from "crypto";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "webhook", "xero");

const WebhookSchema = z.object({
  entropy: z.string().optional(),
  events: z.array(
    z.object({
      tenantId: z.string(),
      eventCategory: z.enum(["CONTACT", "INVOICE"]),
      eventType: z.enum(["CREATE", "UPDATE", "DELETE"]),
      resourceId: z.string(),
      eventDateUtc: z.string()
    })
  ),
  firstEventSequence: z.number(),
  lastEventSequence: z.number()
});

function verifySignature(payload: string, header: string) {
  if (!XERO_WEBHOOK_SECRET) {
    logger.warning("XERO_WEBHOOK_SECRET is not configured");
    return payload;
  }

  const hmac = crypto
    .createHmac("sha256", XERO_WEBHOOK_SECRET)
    .update(payload, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(header));
}

export async function action({ request }: ActionFunctionArgs) {
  // Get the raw payload for signature verification
  const payloadText = await request.text();

  // Verify webhook signature for security (Xero's intent-to-receive workflow)
  if (XERO_WEBHOOK_SECRET) {
    // If payload is empty or just contains intent-to-receive data, return 200
    if (!payloadText || payloadText.trim() === "" || payloadText === "{}") {
      return new Response("", { status: 200 });
    }

    const signature = request.headers.get("x-xero-signature");

    if (!signature) {
      return data(
        { success: false, error: "Missing signature" },
        { status: 401 }
      );
    }

    const isValid = verifySignature(payloadText, signature);

    if (!isValid) {
      return data(
        {
          success: false,
          error: "Invalid signature"
        },
        { status: 401 }
      );
    }
  }

  // Parse and validate the webhook payload for actual events
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    logger.error("Failed to parse webhook payload", { error });
    return data(
      {
        success: false,
        error: "Invalid JSON payload"
      },
      { status: 401 }
    );
  }

  const parsed = WebhookSchema.safeParse(payload);

  if (!parsed.success) {
    logger.error("Invalid Xero webhook payload", { error: parsed.error });
    return data(
      {
        success: false,
        error: "Invalid payload format"
      },
      { status: 401 }
    );
  }

  logger.info("Processing Xero webhook", {
    eventCount: parsed.data.events.length
  });

  const serviceRole = getCarbonServiceRole();
  const events = parsed.data.events;
  const syncJobs = [];
  const errors = [];

  // Group events by tenant ID for efficient processing
  const eventsByTenant = events.reduce(
    (acc, event) => {
      if (!acc[event.tenantId]) {
        acc[event.tenantId] = [];
      }
      acc[event.tenantId].push(event);
      return acc;
    },
    {} as Record<string, typeof events>
  );

  // Process events for each tenant
  for (const [tenantId, tenantEvents] of Object.entries(eventsByTenant)) {
    try {
      const integration = await getAccountingIntegration(
        serviceRole,
        tenantId,
        ProviderID.XERO
      );

      if (!integration) {
        logger.error("No Xero integration found for tenant", { tenantId });
        errors.push({
          tenantId,
          error: "Tenant ID not found in integrations"
        });
        continue;
      }

      const companyId = integration.companyId;

      const provider = getProviderIntegration(
        serviceRole,
        companyId,
        ProviderID.XERO,
        integration.metadata
      );

      // Group entities by type for efficient batch processing
      const entities: Array<AccountingEntity> = [];

      for (const event of tenantEvents) {
        const { resourceId, eventCategory } = event;

        const operation = event.eventType.toLowerCase() as Lowercase<
          AccountingEntity["operation"]
        >;

        // Log each entity change for debugging
        logger.info("Xero entity change", {
          operation,
          eventCategory,
          resourceId,
          tenantId
        });

        switch (eventCategory) {
          case "CONTACT":
            const contactType = await fetchContactType(provider, resourceId);

            if (!contactType) {
              logger.info("Skipping contact with no customer/supplier role", {
                resourceId
              });
              continue;
            }

            if (contactType === "customer" || contactType === "both") {
              entities.push({
                entityType: "customer",
                entityId: resourceId,
                operation: operation
              });
            }

            if (contactType === "supplier" || contactType === "both") {
              entities.push({
                entityType: "vendor",
                entityId: resourceId,
                operation: operation
              });
            }

            break;

          case "INVOICE":
            const invoiceType = await fetchInvoiceType(provider, resourceId);

            if (!invoiceType) {
              logger.info("Skipping invoice - could not determine type", {
                resourceId
              });
              continue;
            }

            entities.push({
              entityType: invoiceType,
              entityId: resourceId,
              operation: operation
            });

            break;
        }
      }

      // Trigger background sync job if there are entities to process
      if (entities.length > 0) {
        try {
          // Prepare the payload for the accounting sync job
          const payload: AccountingSyncPayload = {
            companyId,
            provider: ProviderID.XERO,
            syncType: "webhook",
            syncDirection: "pull-from-accounting",
            entities,
            metadata: {
              tenantId: tenantId,
              raw: parsed.data
            }
          };

          logger.info("Accounting sync payload", { payload });

          // Trigger the background job using Trigger.dev
          await trigger("sync-external-accounting", payload);

          logger.info("Triggered accounting sync job", {
            entityCount: entities.length
          });

          syncJobs.push({
            companyId,
            tenantId,
            entityCount: entities.length
          });
        } catch (error) {
          logger.error("Failed to trigger sync job", { error });
          errors.push({
            tenantId,
            error:
              error instanceof Error ? error.message : "Failed to trigger job"
          });
        }
      }
    } catch (error) {
      logger.error("Error processing events for tenant", { tenantId, error });
      errors.push({
        tenantId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  logger.info("Processed Xero webhook", { syncJobsTriggered: syncJobs.length });

  // Return detailed response
  return {
    success: errors.length === 0,
    jobsTriggered: syncJobs.length,
    jobs: syncJobs,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString()
  };
}

const fetchContactType = async (
  provider: AccountingProvider,
  resourceId: string
) => {
  const res = await provider.request<{
    Contacts: { IsSupplier: boolean; IsCustomer: boolean }[];
  }>("GET", `/Contacts/${resourceId}`);

  if (res.error || !res.data || res.data.Contacts.length === 0) {
    throw new Error(`Failed to fetch contact ${resourceId}: ${res.message}`);
  }

  const contact = res.data.Contacts[0];

  if (contact.IsSupplier && contact.IsCustomer) {
    return "both";
  } else if (contact.IsSupplier) {
    return "supplier";
  } else if (contact.IsCustomer) {
    return "customer";
  }

  return null;
};

/**
 * Fetches invoice from Xero to determine if it's a sales invoice or bill.
 * - ACCREC (Accounts Receivable) = Sales Invoice -> maps to "invoice"
 * - ACCPAY (Accounts Payable) = Purchase Invoice/Bill -> maps to "bill"
 */
const fetchInvoiceType = async (
  provider: AccountingProvider,
  resourceId: string
): Promise<"invoice" | "bill" | null> => {
  const res = await provider.request<{
    Invoices: { Type: "ACCREC" | "ACCPAY" }[];
  }>("GET", `/Invoices/${resourceId}`);

  if (res.error || !res.data || res.data.Invoices.length === 0) {
    throw new Error(`Failed to fetch invoice ${resourceId}: ${res.message}`);
  }

  const invoice = res.data.Invoices[0];

  // ACCREC = Accounts Receivable = Sales Invoice
  // ACCPAY = Accounts Payable = Bill/Purchase Invoice
  return invoice.Type === "ACCREC" ? "invoice" : "bill";
};
