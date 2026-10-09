// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { ONSHAPE_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { beginOAuthPopup } from "../oauth-popup";
import { Logo, onshapeReconnectAction } from "./config";
import { ONSHAPE_V2_INTEGRATION_ID } from "./lib/integration-id";

/**
 * The panel integration: push-only, driven from inside Onshape's element right
 * panel. Separate from `onshape` (the pull-shaped original) because it holds
 * its own OAuth grant and writes its own `externalIntegrationMapping`
 * namespace — see `./lib/integration-id`.
 */
export const OnshapeV2 = defineIntegration({
  name: "Onshape V2",
  id: ONSHAPE_V2_INTEGRATION_ID,
  active: !!ONSHAPE_CLIENT_ID,
  category: "CAD",
  logo: Logo,
  description:
    "Onshape is a browser-based CAD/PLM software for modern engineering teams. This integration adds a panel inside Onshape for pushing parts, assemblies and releases into Carbon.",
  shortDescription: "Push CAD data to Carbon from inside Onshape.",
  images: [],
  /*
   * No settings here: what a push fills in when nothing maps a field (the
   * push defaults) is set on the panel's Fields page, next to the property
   * map, so one page shows everything a push writes. The connection keys and
   * those values share the metadata column; see `./lib/state`.
   */
  settings: [],
  schema: z.object({}),
  actions: [onshapeReconnectAction("/api/integrations/onshape-v2/install")],
  onClientInstall: async () => {
    // Opened here, inside the click, so the browser still holds user
    // activation; the fetch below can take as long as it needs.
    const popup = beginOAuthPopup();
    let error = "unexpected";
    try {
      const response = await fetch("/api/integrations/onshape-v2/install");
      const body = (await response.json()) as { url?: string; error?: string };
      if (body?.url) {
        // The callback (api/integrations/onshape-v2/oauth) posts an
        // OAuthPopupResult back to this window and closes the popup;
        // IntegrationCard listens for it.
        popup.navigate(body.url);
        return;
      }
      error = body?.error ?? error;
    } catch {
      // Fall through to the error toast below.
    }
    popup.close();
    // The integrations page turns `?integration=&error=` into a toast — the
    // same place a failed callback lands (see integration-errors.ts).
    window.location.href = `/x/settings/integrations?integration=${ONSHAPE_V2_INTEGRATION_ID}&error=${error}`;
  }
});
