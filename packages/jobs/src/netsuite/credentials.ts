import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import {
  createM2mAuth,
  type NetSuiteAuth,
  NetSuiteClient
} from "@carbon/netsuite";

/**
 * Build a NetSuite client from the company's connected integration.
 *
 * Credentials never travel in the Inngest event payload — an event body is
 * stored in run history and shown in the Inngest dashboard, which is not a place
 * for a customer's private key. The job resolves them here instead, from
 * `companyIntegration.metadata` plus Supabase Vault, with a service-role client
 * because the vault RPCs accept nothing else.
 */

export const NETSUITE_INTEGRATION_ID = "netsuite";

export type NetSuiteConnection = {
  client: NetSuiteClient;
  accountId: string;
};

type NetSuiteMetadata = {
  accountId?: string;
  authMethod?: string;
  clientId?: string;
  certificateId?: string;
  privateKey?: string;
  consumerKey?: string;
  consumerSecret?: string;
  tokenId?: string;
  tokenSecret?: string;
};

/** Thrown when the connection is missing or incomplete, with a message a user can act on. */
export class NetSuiteNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetSuiteNotConnectedError";
  }
}

export async function getNetSuiteConnection(
  companyId: string
): Promise<NetSuiteConnection> {
  const client = getCarbonServiceRole();

  const integration = await client
    .from("companyIntegration")
    .select("metadata, secretRef, active")
    .eq("id", NETSUITE_INTEGRATION_ID)
    .eq("companyId", companyId)
    .maybeSingle();

  if (integration.error) {
    throw new Error(
      `Could not read the NetSuite integration: ${integration.error.message}`
    );
  }
  if (!integration.data?.active) {
    throw new NetSuiteNotConnectedError(
      "NetSuite is not connected for this company — connect it in Settings → Integrations first."
    );
  }

  const resolved = (await resolveIntegrationSecrets(
    client,
    companyId,
    NETSUITE_INTEGRATION_ID,
    integration.data.metadata,
    integration.data.secretRef
  )) as NetSuiteMetadata;

  const accountId = resolved.accountId?.trim();
  if (!accountId) {
    throw new NetSuiteNotConnectedError(
      "The NetSuite connection has no account id."
    );
  }

  const auth = await buildAuth(accountId, resolved);
  return { client: new NetSuiteClient({ auth }), accountId };
}

async function buildAuth(
  accountId: string,
  metadata: NetSuiteMetadata
): Promise<NetSuiteAuth> {
  const usesTba = metadata.authMethod === "Token-Based Authentication";

  if (usesTba) {
    const { consumerKey, consumerSecret, tokenId, tokenSecret } = metadata;
    if (!consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
      throw new NetSuiteNotConnectedError(
        "The NetSuite connection is set to Token-Based Authentication but is missing one of its four credentials."
      );
    }
    return {
      type: "tba",
      accountId,
      consumerKey,
      consumerSecret,
      tokenId,
      tokenSecret
    };
  }

  const { clientId, certificateId, privateKey } = metadata;
  if (!clientId || !certificateId || !privateKey) {
    throw new NetSuiteNotConnectedError(
      "The NetSuite connection is missing its client id, certificate id or private key."
    );
  }

  // Mints the first access token, so a bad key fails HERE — with NetSuite's own
  // message — rather than as an opaque 401 partway through the extract.
  return createM2mAuth({ accountId, clientId, certificateId, privateKey });
}
