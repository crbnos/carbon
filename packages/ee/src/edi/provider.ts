// Provider-agnostic EDI interface + registry. Concrete adapters (e.g. Orderful)
// register themselves; the ERP glue only ever talks to this interface.

import type {
  EdiDocumentType,
  EdiOrderPayload,
  EdiOutboundPayload,
  ParsedEdiWebhook
} from "./types";

export type EdiProviderCredentials = {
  apiKey: string;
  webhookSecret: string;
  environment?: "sandbox" | "production";
};

export interface EdiProvider {
  readonly id: "orderful"; // future: "stedi", ...
  /** Verify the signature and normalize a provider webhook. Returns null on a bad signature. */
  parseWebhook(args: {
    rawBody: string;
    signature: string | null;
    secret: string;
  }): Promise<ParsedEdiWebhook | null>;
  /** Re-fetch a transaction's full payload (when the webhook didn't embed it). */
  getTransaction(
    creds: EdiProviderCredentials,
    externalId: string
  ): Promise<{ documentType: EdiDocumentType; payload: EdiOrderPayload }>;
  /** Send an outbound document; returns the provider's transaction id. */
  sendTransaction(
    creds: EdiProviderCredentials,
    args: {
      partnerExternalId: string;
      documentType: EdiDocumentType;
      payload: EdiOutboundPayload;
    }
  ): Promise<{ externalId: string }>;
}

export const ediProviderIds = ["orderful"] as const;
export type EdiProviderId = (typeof ediProviderIds)[number];

const registry = new Map<EdiProviderId, EdiProvider>();

export function registerEdiProvider(provider: EdiProvider): void {
  registry.set(provider.id, provider);
}

export function getEdiProvider(id: EdiProviderId): EdiProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new Error(`Unknown EDI provider: ${id}`);
  }
  return provider;
}
