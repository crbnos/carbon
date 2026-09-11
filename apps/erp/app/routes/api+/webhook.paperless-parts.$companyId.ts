import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import crypto from "crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getIntegration } from "~/modules/settings/settings.service";

const logger = getLogger("erp", "webhook-paperless-parts-companyid");

const integrationValidator = z.object({
  apiKey: z.string(),
  secretKey: z.string()
});

function createHmacSignature(
  requestPayload: string,
  signingSecret: string,
  timestamp: number
): string {
  const message = `${timestamp}.${requestPayload}`;
  const messageBytes = Buffer.from(message);
  const signingSecretBytes = Buffer.from(signingSecret, "hex");

  return crypto
    .createHmac("sha256", signingSecretBytes)
    .update(messageBytes)
    .digest("hex");
}

function signaturesMatch(signature: string, expectedSignature: string) {
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  return (
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return {
    success: true
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  const serviceRole = await getCarbonServiceRole();
  const paperlessPartsIntegration = await getIntegration(
    serviceRole,
    "paperless-parts",
    companyId
  );

  if (paperlessPartsIntegration.error || !paperlessPartsIntegration.data) {
    return data({ success: false }, { status: 400 });
  }

  try {
    // Secret material (apiKey/secretKey) lives in Supabase Vault; merge it back
    // so we read the same shape as before. serviceRole is required for vault RPCs.
    const resolvedMetadata = await resolveIntegrationSecrets(
      serviceRole,
      companyId,
      "paperless-parts",
      paperlessPartsIntegration.data.metadata,
      paperlessPartsIntegration.data.secretRef
    );
    const { apiKey, secretKey } = integrationValidator.parse(resolvedMetadata);

    // HMACs authenticate bytes, not parsed JSON. Paperless signs the serialized
    // request body, so preserve it exactly (including escapes and number syntax).
    const rawPayloadText = await request.text();
    const payload = JSON.parse(rawPayloadText);

    // Keep accepting the historical normalized representation for deliveries
    // where Paperless signed json.dumps(payload) but transmitted different
    // whitespace. New deliveries should match the raw body.
    const normalizedPayloadText = JSON.stringify(payload, null, 1)
      .replace(/^ +/gm, " ")
      .replace(/\n/g, "")
      .replace(/{ /g, "{")
      .replace(/ }/g, "}")
      .replace(/\[ /g, "[")
      .replace(/ \]/g, "]");

    const signatureHeader =
      request.headers.get("paperless-parts-signature") ||
      request.headers.get("Paperless-Parts-Signature");
    if (!signatureHeader) {
      logger.warning("Paperless Parts webhook rejected", {
        companyId,
        reason: "missing_signature_header"
      });
      return data({ success: false }, { status: 401 });
    }

    // Parse timestamp and signature from header
    const [timestampPart, signaturePart] = signatureHeader.split(",");
    if (!timestampPart || !signaturePart) {
      logger.warning("Paperless Parts webhook rejected", {
        companyId,
        reason: "malformed_signature_header"
      });
      return data({ success: false }, { status: 401 });
    }
    const timestamp = Number(timestampPart.replace("t=", ""));
    const signature = signaturePart.replace("v1=", "");

    if (!timestamp || !signature) {
      logger.warning("Paperless Parts webhook rejected", {
        companyId,
        reason: "malformed_signature_header"
      });
      return data({ success: false }, { status: 401 });
    }

    // Constant-time comparison (SC-13): a plain `!==` leaks, via timing, how many
    // leading bytes of a forged signature are correct. Check both the exact
    // signed bytes and the legacy normalized representation for compatibility.
    const signedPayloadCandidates = new Set([
      rawPayloadText,
      normalizedPayloadText
    ]);
    if (
      ![...signedPayloadCandidates].some((candidate) =>
        signaturesMatch(
          signature,
          createHmacSignature(candidate, secretKey, timestamp)
        )
      )
    ) {
      logger.warning("Paperless Parts webhook rejected", {
        companyId,
        reason: "signature_mismatch"
      });
      return data({ success: false }, { status: 401 });
    }

    logger.info("payload", payload);

    await trigger("paperless-parts", {
      apiKey,
      companyId,
      payload
    });

    return { success: true };
  } catch (err) {
    logger.error("Paperless Parts webhook failed", {
      companyId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return data({ success: false }, { status: 500 });
  }
}
