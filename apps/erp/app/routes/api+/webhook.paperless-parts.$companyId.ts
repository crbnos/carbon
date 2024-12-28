import { getCarbonServiceRole } from "@carbon/auth";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import crypto from "crypto";
import { z } from "zod";
import { getIntegration } from "~/modules/settings/settings.service";
import type { paperlessPartsTask } from "~/trigger/paperless-parts";

export const config = {
  runtime: "nodejs",
};

const integrationValidator = z.object({
  apiKey: z.string(),
  secretKey: z.string(),
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

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return json({ success: false }, { status: 400 });
  }

  const serviceRole = await getCarbonServiceRole();
  const paperlessPartsIntegration = await getIntegration(
    serviceRole,
    companyId,
    "paperless-parts"
  );

  if (paperlessPartsIntegration.error || !paperlessPartsIntegration.data) {
    return json({ success: false }, { status: 400 });
  }

  try {
    const { apiKey, secretKey } = integrationValidator.parse(
      paperlessPartsIntegration.data
    );

    const payloadText = await request.text();
    const signatureHeader = request.headers.get("Paperless-Parts-Signature");

    if (!signatureHeader) {
      return json({ success: false }, { status: 401 });
    }

    // Parse timestamp and signature from header
    const [timestampPart, signaturePart] = signatureHeader.split(",");
    const timestamp = Number(timestampPart.replace("t=", ""));
    const signature = signaturePart.replace("v1=", "");

    if (!timestamp || !signature) {
      return json({ success: false }, { status: 401 });
    }

    const expectedSignature = createHmacSignature(
      payloadText,
      secretKey,
      timestamp
    );

    if (signature !== expectedSignature) {
      return json({ success: false }, { status: 401 });
    }

    await tasks.trigger<typeof paperlessPartsTask>("paperless-parts", {
      apiKey,
      companyId,
      payload: JSON.parse(payloadText),
    });

    return json({ success: true });
  } catch (err) {
    return json({ success: false }, { status: 500 });
  }
}
