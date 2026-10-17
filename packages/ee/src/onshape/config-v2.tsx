// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { ONSHAPE_V2_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { beginOAuthPopup } from "../oauth-popup";
import { Logo, onshapeReconnectAction } from "./config";
import { ONSHAPE_V2_INTEGRATION_ID } from "./lib/integration-id";

export const OnshapeV2 = defineIntegration({
  name: "Onshape V2",
  id: ONSHAPE_V2_INTEGRATION_ID,
  active: !!ONSHAPE_V2_CLIENT_ID,
  category: "CAD",
  logo: Logo,
  description:
    "Onshape is a browser-based CAD/PLM software for modern engineering teams. This integration adds a panel inside Onshape for pushing parts, assemblies and releases into Carbon.",
  shortDescription: "Push CAD data to Carbon from inside Onshape.",
  images: [],
  // Push defaults live on the panel's Fields page beside the property map.
  settings: [],
  schema: z.object({}),
  actions: [onshapeReconnectAction("/api/integrations/onshape-v2/install")],
  onClientInstall: async () => {
    const popup = beginOAuthPopup();
    let error = "unexpected";
    try {
      const response = await fetch("/api/integrations/onshape-v2/install");
      const body = (await response.json()) as { url?: string; error?: string };
      if (body?.url) {
        popup.navigate(body.url);
        return;
      }
      error = body?.error ?? error;
    } catch {
      // Falls through to the error redirect.
    }
    popup.close();
    window.location.href = `/x/settings/integrations?integration=${ONSHAPE_V2_INTEGRATION_ID}&error=${error}`;
  }
});
