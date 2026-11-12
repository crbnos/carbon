// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { OnshapeIntegrationId } from "./connection";

// The panel app's grant; the mapping namespace of both panel grants. Sync rows
// (`onshape`, `onshape-government`) are BOM-import bookkeeping: the item lock,
// card and Detach read `onshape-v2` only, never an `"onshape"` literal.
export const ONSHAPE_V2_INTEGRATION_ID = "onshape-v2";

/**
 * The panel through the customer's private app on Onshape Government. Its
 * mappings stay under `onshape-v2`: they name the source system.
 */
export const ONSHAPE_V2_GOVERNMENT_INTEGRATION_ID = "onshape-v2-government";

/** The panel's two grants; a company holds one active at a time. */
export const ONSHAPE_PANEL_INTEGRATION_IDS = [
  ONSHAPE_V2_INTEGRATION_ID,
  ONSHAPE_V2_GOVERNMENT_INTEGRATION_ID
] as const;

export type OnshapePanelIntegrationId =
  (typeof ONSHAPE_PANEL_INTEGRATION_IDS)[number];

export const ONSHAPE_V2_GOVERNMENT_OAUTH_CALLBACK_PATH =
  "/api/integrations/onshape-v2-government/oauth";

export function isOnshapePanelIntegrationId(
  id: string | null | undefined
): id is OnshapePanelIntegrationId {
  return (ONSHAPE_PANEL_INTEGRATION_IDS as readonly string[]).includes(
    id ?? ""
  );
}

/** Every Onshape integration with its own OAuth grant: sync and panel. */
export type OnshapeOAuthIntegrationId =
  | OnshapeIntegrationId
  | OnshapePanelIntegrationId;
