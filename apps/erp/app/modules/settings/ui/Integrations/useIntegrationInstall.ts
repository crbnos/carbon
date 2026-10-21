// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { toast } from "@carbon/react";
import { useCallback } from "react";
import { useFetcher, useNavigate } from "react-router";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings", "integrations");

/**
 * Installing an integration, from wherever it is offered — the card in the grid and the
 * Details drawer.
 *
 * Shared so the two can never disagree about what Install means: an OAuth integration opens
 * the vendor's consent screen, one with required settings opens its form, and anything else
 * installs in place. `integration` may be undefined so this can be called before the caller
 * has resolved one (rules of hooks).
 */
/** Only what installing needs. Structural rather than `Integration`, whose generic
 * variants don't all assign back to the bare type. */
export type InstallableIntegration = {
  id: string;
  name: string;
  settings: readonly { required?: boolean }[];
  onClientInstall?: () => void | Promise<void>;
  oauth?: {
    authUrl: string;
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
  };
};

/**
 * Hand off to the connect route — for EVERY OAuth integration. The route builds
 * the authorize URL server-side and sets the HttpOnly state cookie the callback
 * needs, so this is a full navigation, not a popup.
 */
export function startOAuthConnect(integrationId: string, mode?: string) {
  const url = new URL(
    `/api/integrations/${integrationId}/connect`,
    window.location.origin
  );
  if (mode) url.searchParams.set("mode", mode);
  window.location.href = url.toString();
}

export function useIntegrationInstall(
  integration: InstallableIntegration | undefined
) {
  const fetcher = useFetcher<{}>();
  const navigate = useNavigate();

  const install = useCallback(async () => {
    if (!integration) return;

    if ("oauth" in integration && integration.oauth) {
      startOAuthConnect(integration.id);
      return;
    }

    if (integration.settings.some((setting) => setting.required)) {
      navigate(path.to.integration(integration.id));
      return;
    }

    if (integration.onClientInstall) {
      try {
        await integration.onClientInstall();
      } catch (error) {
        logger.error("Client install failed", {
          integration: integration.id,
          error
        });
        toast.error(`Couldn't start the ${integration.name} connection`);
      }
      return;
    }

    fetcher.submit(new FormData(), {
      method: "post",
      action: path.to.integration(integration.id)
    });
  }, [integration, navigate, fetcher]);

  return { install, isInstalling: fetcher.state !== "idle" };
}
