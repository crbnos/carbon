// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { OnshapeIntegrationId } from "./connection";

// The panel's own grant, credential row and mapping namespace. Sync rows
// (`onshape`, `onshape-government`) are BOM-import bookkeeping: the item lock,
// card and Detach read `onshape-v2` only, never an `"onshape"` literal.
export const ONSHAPE_V2_INTEGRATION_ID = "onshape-v2";

export type OnshapeV2IntegrationId = typeof ONSHAPE_V2_INTEGRATION_ID;

/** Every Onshape integration with its own OAuth grant: sync and panel. */
export type OnshapeOAuthIntegrationId =
  | OnshapeIntegrationId
  | OnshapeV2IntegrationId;
