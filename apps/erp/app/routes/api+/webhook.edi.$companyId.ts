import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import type { EdiProviderCredentials } from "@carbon/ee/edi.server";
import { ediProviderIds, getEdiProvider } from "@carbon/ee/edi.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { processInboundEdiTransaction } from "~/modules/sales";
import { getIntegration } from "~/modules/settings";

// crypto (HMAC signature verification) needs the Node runtime.
export const config = { runtime: "nodejs" };

const logger = getLogger("erp", "webhook-edi-companyid");

export async function loader({ params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }
  return { success: true };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  const serviceRole = getCarbonServiceRole();

  // Find the company's active EDI provider integration.
  let providerId: (typeof ediProviderIds)[number] | null = null;
  let creds: EdiProviderCredentials | null = null;
  for (const id of ediProviderIds) {
    const integration = await getIntegration(serviceRole, id, companyId);
    if (integration.data?.active) {
      providerId = id;
      try {
        // Secret material (apiKey/webhookSecret) lives in Supabase Vault; merge
        // it back so we read the same shape as before. serviceRole is required
        // for the vault RPCs.
        const resolved = await resolveIntegrationSecrets(
          serviceRole,
          companyId,
          id,
          integration.data.metadata,
          integration.data.secretRef
        );
        creds = resolved as unknown as EdiProviderCredentials;
      } catch (err) {
        logger.error("EDI webhook: failed to resolve integration secrets", {
          error: err
        });
        // Non-2xx → the provider redelivers once the secret is repaired.
        return data({ success: false }, { status: 500 });
      }
      break;
    }
  }

  if (!providerId || !creds) {
    return data(
      { success: false, error: "EDI integration not active" },
      { status: 400 }
    );
  }

  const provider = getEdiProvider(providerId);

  // Read the RAW body before any JSON parse (signature is over the raw bytes).
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-orderful-signature") ??
    request.headers.get("x-edi-signature");

  const parsed = await provider.parseWebhook({
    rawBody,
    signature,
    secret: creds.webhookSecret
  });
  if (!parsed) {
    return data(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  // Fill the transaction payload from the provider API if the webhook omitted it.
  if (parsed.kind === "transaction" && !parsed.payload) {
    try {
      const fetched = await provider.getTransaction(creds, parsed.externalId);
      parsed.payload = fetched.payload;
    } catch (err) {
      logger.error("EDI webhook: failed to fetch transaction payload", {
        error: err
      });
      // Non-2xx → the provider redelivers.
      return data({ success: false }, { status: 500 });
    }
  }

  const result = await processInboundEdiTransaction(serviceRole, {
    companyId,
    parsed
  });

  if (result.error) {
    logger.error("EDI webhook: failed to process transaction", result.error);
    return data({ success: false }, { status: 500 });
  }

  return { success: true };
}
