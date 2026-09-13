import { ONSHAPE_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { beginOAuthPopup } from "../oauth-popup";
import { Logo } from "./config";
import { ONSHAPE_V2_INTEGRATION_ID } from "./lib/integration-id";

/**
 * The panel integration: push-only, driven from inside Onshape's element right
 * panel. Separate from `onshape` (the pull-shaped original) because it holds
 * its own OAuth grant and writes its own `externalIntegrationMapping`
 * namespace — see `./lib/integration-id`.
 *
 * Connect and disconnect happen here; everything else is configured inside the
 * panel, on its Settings page.
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
   * No settings here. The five push defaults used to live on this form, which
   * meant someone working inside Onshape had to leave the CAD document to
   * change one — so they moved to the panel's own Settings page, which writes
   * the same `companyIntegration.metadata` keys through
   * `api/integrations/onshape/panel/preferences`. `parsePushDefaults` still
   * reads them, and values this form wrote are still honoured; only the place
   * you edit them changed.
   */
  settingGroups: [],
  settings: [],
  schema: z.object({}),
  onClientInstall: async () => {
    // Opened here, inside the click, so the browser still holds user
    // activation; the fetch below can take as long as it needs.
    const popup = beginOAuthPopup();
    try {
      const response = await fetch("/api/integrations/onshape-v2/install");
      const body = await response.json();
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? `Carbon answered ${response.status}`);
      }
      popup.navigate(body.url);
    } catch (error) {
      popup.close();
      throw error;
    }
  }
});
