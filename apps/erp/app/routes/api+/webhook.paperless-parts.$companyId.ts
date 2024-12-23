import { getCarbonServiceRole } from "@carbon/auth";
import type { paperlessPartsTask } from "@carbon/jobs/trigger/paperless-parts";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import crypto from "crypto";
import { z } from "zod";
import { getIntegration } from "~/modules/settings/settings.service";

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
    "paperless-parts",
    companyId
  );

  if (paperlessPartsIntegration.error || !paperlessPartsIntegration.data) {
    return json({ success: false }, { status: 400 });
  }

  try {
    const { apiKey, secretKey } = integrationValidator.parse(
      paperlessPartsIntegration.data.metadata
    );

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
