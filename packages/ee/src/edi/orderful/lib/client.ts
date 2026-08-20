import { createHmac, timingSafeEqual } from "node:crypto";
import type { EdiProvider, EdiProviderCredentials } from "../../provider";
import { registerEdiProvider } from "../../provider";
import type {
  EdiDocumentType,
  EdiOrderPayload,
  EdiOutboundPayload,
  ParsedEdiWebhook
} from "../../types";
import { parseOrderfulWebhook } from "./mapper";

// Until the Orderful account exists and the API contract is confirmed against a
// sandbox (spec ⚠️ vendor signup), the re-fetch and send paths refuse to guess
// wire responses. The webhook-embedded inbound path is fully functional.
const NOT_VERIFIED =
  "orderful adapter not verified against sandbox — confirm the API contract before enabling outbound EDI";

function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

class OrderfulProvider implements EdiProvider {
  readonly id = "orderful" as const;

  async parseWebhook(args: {
    rawBody: string;
    signature: string | null;
    secret: string;
  }): Promise<ParsedEdiWebhook | null> {
    if (!verifySignature(args.rawBody, args.signature, args.secret)) {
      return null;
    }
    let body: unknown;
    try {
      body = JSON.parse(args.rawBody);
    } catch {
      return null;
    }
    return parseOrderfulWebhook(body);
  }

  async getTransaction(
    _creds: EdiProviderCredentials,
    _externalId: string
  ): Promise<{ documentType: EdiDocumentType; payload: EdiOrderPayload }> {
    // Only hit when a webhook omits the embedded transaction. Confirm Orderful's
    // GET /transactions/{id} response shape against the sandbox before enabling.
    throw new Error(NOT_VERIFIED);
  }

  async sendTransaction(
    _creds: EdiProviderCredentials,
    _args: {
      partnerExternalId: string;
      documentType: EdiDocumentType;
      payload: EdiOutboundPayload;
    }
  ): Promise<{ externalId: string }> {
    // Confirm Orderful's POST /transactions request + response shape against the
    // sandbox before enabling outbound sends (mapper.fromCanonical is the seam).
    throw new Error(NOT_VERIFIED);
  }
}

export const orderfulProvider = new OrderfulProvider();
registerEdiProvider(orderfulProvider);
