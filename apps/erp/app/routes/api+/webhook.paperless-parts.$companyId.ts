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

    // The signature provided by Paperless Parts is computed using the Python json.dumps() function,
    // which formats the JSON string with newlines and whitespace.
    // We need to remove the newlines and whitespace to match the signature.
    const payloadText = JSON.stringify(await request.json(), null, 1)
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
      return data({ success: false }, { status: 401 });
    }

    // Parse timestamp and signature from header
    const [timestampPart, signaturePart] = signatureHeader.split(",");
    const timestamp = Number(timestampPart.replace("t=", ""));
    const signature = signaturePart.replace("v1=", "");

    if (!timestamp || !signature) {
      return data({ success: false }, { status: 401 });
    }

    const expectedSignature = createHmacSignature(
      payloadText,
      secretKey,
      timestamp
    );

    // Constant-time comparison (SC-13): a plain `!==` leaks, via timing, how many
    // leading bytes of a forged signature are correct. Guard length first —
    // timingSafeEqual throws on unequal-length buffers.
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return data({ success: false }, { status: 401 });
    }

    const payload = JSON.parse(payloadText);
    logger.info("payload", payload);

    await trigger("paperless-parts", {
      apiKey,
      companyId,
      payload
    });

    return { success: true };
  } catch (_err) {
    return data({ success: false }, { status: 500 });
  }
}
