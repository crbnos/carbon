// The two Onshape integration ids, and the rules that relate them.
//
// Onshape v2 is a SEPARATE integration record from the shipped `onshape` one.
// They share the Onshape OAuth application and this package's protocol client;
// nothing else. Each holds its own grant, its own settings, its own webhook
// subscription and its own vault secret bag
// (`integration:{companyId}:{integrationId}`).
//
// Kept in its own module, free of imports, so both the pure settings parsers and
// the server-only hooks can depend on it without a cycle.

export const ONSHAPE_LEGACY_INTEGRATION_ID = "onshape";
export const ONSHAPE_V2_INTEGRATION_ID = "onshape-v2";

export const ONSHAPE_INTEGRATION_IDS = [
  ONSHAPE_LEGACY_INTEGRATION_ID,
  ONSHAPE_V2_INTEGRATION_ID
] as const;

export type OnshapeIntegrationId = (typeof ONSHAPE_INTEGRATION_IDS)[number];

export function isOnshapeIntegrationId(
  id: string | null | undefined
): id is OnshapeIntegrationId {
  return (
    id === ONSHAPE_LEGACY_INTEGRATION_ID || id === ONSHAPE_V2_INTEGRATION_ID
  );
}

/**
 * The OTHER Onshape integration. Exactly one of the two may be active for a
 * company: both would subscribe to `onshape.revision.created` on the same
 * Onshape tenant, so every released element would be delivered and processed
 * twice — two change notices for one release, a UNIQUE(changeOrderId, itemId)
 * violation on the second affected item, and double the export quota.
 */
export function counterpartOnshapeIntegrationId(
  id: OnshapeIntegrationId
): OnshapeIntegrationId {
  return id === ONSHAPE_V2_INTEGRATION_ID
    ? ONSHAPE_LEGACY_INTEGRATION_ID
    : ONSHAPE_V2_INTEGRATION_ID;
}

/**
 * Where Onshape POSTs this company's release events, per integration.
 *
 * The two paths must not be substrings of one another: registration returns
 * "already registered" when any existing webhook URL CONTAINS the path, and
 * deregistration deletes every webhook whose URL contains it. A nested path
 * (`/api/webhook/onshape/{c}/v2`) would therefore make the legacy disconnect
 * silently delete v2's subscription. `onshape-v2` as its own segment diverges
 * before any company-controlled text, so no companyId can make them collide.
 *
 * The legacy path is frozen: changing it would orphan every subscription already
 * registered in production, and legacy's own deregister would never find them.
 */
export function onshapeWebhookPath(
  integrationId: OnshapeIntegrationId,
  companyId: string
): string {
  return integrationId === ONSHAPE_V2_INTEGRATION_ID
    ? `/api/webhook/onshape-v2/${companyId}`
    : `/api/webhook/onshape/${companyId}`;
}
