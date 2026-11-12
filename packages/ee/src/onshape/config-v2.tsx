// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getAppUrl, ONSHAPE_V2_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { beginOAuthPopup } from "../oauth-popup";
import {
  customerAppSettings,
  customerAppSettingsSchema,
  Logo,
  onshapeReconnectAction
} from "./config";
import {
  ONSHAPE_V2_GOVERNMENT_INTEGRATION_ID,
  ONSHAPE_V2_GOVERNMENT_OAUTH_CALLBACK_PATH,
  ONSHAPE_V2_INTEGRATION_ID
} from "./lib/integration-id";

export const OnshapeV2 = defineIntegration({
  name: "Onshape V2",
  id: ONSHAPE_V2_INTEGRATION_ID,
  active: !!ONSHAPE_V2_CLIENT_ID,
  internalOnly: true,
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

/**
 * The panel on Onshape Government through a private app the customer's
 * Enterprise owns. Always configured: the OAuth client is the customer's.
 */
export const OnshapeV2Government = defineIntegration({
  name: "Onshape V2 Government",
  id: ONSHAPE_V2_GOVERNMENT_INTEGRATION_ID,
  active: true,
  internalOnly: true,
  category: "CAD",
  logo: Logo,
  setupInstructions: GovernmentPanelSetupInstructions,
  description:
    "Onshape Government is the ITAR and FedRAMP edition of Onshape, hosted in AWS GovCloud. It has no public App Store, so this integration connects the Carbon panel through a private OAuth app your Enterprise owns. Engineers push parts, assemblies and releases into Carbon from inside Onshape, as with Onshape V2.",
  shortDescription:
    "Push CAD data to Carbon from inside Onshape Government, through a private app.",
  images: [],
  settingGroups: [
    {
      name: "Connection",
      description:
        "The private OAuth app created in your Onshape Enterprise. Every API call counts toward your Enterprise's yearly Onshape API limit."
    }
  ],
  settings: customerAppSettings,
  schema: customerAppSettingsSchema,
  actions: []
});

// The extension's action URL: the panel reads these names, Onshape fills in the
// placeholders and appends `server`, `companyId`, `userId`, `locale` and
// `clientId` itself.
const PANEL_ACTION_QUERY =
  "documentId={$documentId}&wv={$workspaceOrVersion}&wvId={$workspaceOrVersionId}&elementId={$elementId}&partNumber={$partNumber}&revision={$revision}&nodeId={$nodeId}&occurrencePath={$occurrencePath}&configuration={$configuration}";

function GovernmentPanelSetupInstructions() {
  // The address the OAuth redirect is built on, which an alias the admin
  // browses through may not be.
  const origin = getAppUrl();
  const callbackUrl = `${origin}${ONSHAPE_V2_GOVERNMENT_OAUTH_CALLBACK_PATH}`;
  const actionUrl = `${origin}/onshape/panel?${PANEL_ACTION_QUERY}`;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        1. An Enterprise admin signs in to Onshape Government and opens
        Enterprise settings → Developer → OAuth applications → Create new OAuth
        application. If you would rather not do this yourselves, give Carbon
        support a seat in your Enterprise and we will build it with you.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        2. Name it <span className="font-mono">Carbon</span>, give it any unique
        primary format such as{" "}
        <span className="font-mono">com.carbon.panel</span>, and choose{" "}
        <strong>Integrated Cloud App</strong> as the type. Leave the OAuth URL
        empty.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        3. Set the redirect URL to{" "}
        <span className="font-mono break-all">{callbackUrl}</span>.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        4. Grant <strong>Application can read your profile information</strong>,{" "}
        <strong>Application can read your documents</strong> and{" "}
        <strong>Application can write to your documents</strong>. Write access
        is only used to export models and drawings for a push.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        5. Create the application and copy the client ID and secret straight
        away — Onshape shows the secret once.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        6. On the application's Extensions tab, add two extensions with location{" "}
        <strong>Element right panel</strong>, one with context{" "}
        <strong>Inside part studio</strong> and one with{" "}
        <strong>Inside assembly</strong>. Give both this action URL:{" "}
        <span className="font-mono break-all">{actionUrl}</span>
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        7. Add the users or teams who should see the panel to the application.
        Light users cannot be added.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        8. Enter your Onshape URL and the client ID and secret below, then save:
        Carbon sends you to Onshape to approve the connection.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        The app is private to your Enterprise, so its API calls count toward
        your Enterprise's yearly Onshape API limit. Every review in the panel
        reads Onshape, and a push exports a STEP model and drawings for each
        changed part and assembly.
      </p>
    </>
  );
}
