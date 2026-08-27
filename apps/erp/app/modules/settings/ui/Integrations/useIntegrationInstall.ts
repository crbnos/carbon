import { useRouteData } from "@carbon/react";
import { useCallback } from "react";
import { useFetcher, useNavigate } from "react-router";
import { path } from "~/utils/path";

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
  settings: readonly { required?: boolean }[];
  onClientInstall?: () => void | Promise<void>;
  oauth?: {
    authUrl: string;
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
  };
};

export function useIntegrationInstall(
  integration: InstallableIntegration | undefined
) {
  const fetcher = useFetcher<{}>();
  const navigate = useNavigate();
  const routeData = useRouteData<{ state: string }>(path.to.integrations);
  const state = routeData?.state;

  const install = useCallback(async () => {
    if (!integration) return;

    if ("oauth" in integration && !!integration.oauth) {
      const { clientId, redirectUri, scopes } = integration.oauth;
      const encodedRedirectUri = encodeURIComponent(
        `${window.location.origin}${redirectUri}`
      );
      const encodedScopes = encodeURIComponent(scopes.join(" "));
      const encodedState = encodeURIComponent(
        state ?? Math.random().toString(36).substring(2, 15)
      );
      window.open(
        `${integration.oauth.authUrl}?client_id=${clientId}&redirect_uri=${encodedRedirectUri}&response_type=code&state=${encodedState}&scope=${encodedScopes}`
      );
      return;
    }

    if (integration.settings.some((setting) => setting.required)) {
      navigate(path.to.integration(integration.id));
      return;
    }

    if (integration.onClientInstall) {
      await integration.onClientInstall();
      return;
    }

    fetcher.submit(new FormData(), {
      method: "post",
      action: path.to.integration(integration.id)
    });
  }, [integration, navigate, fetcher, state]);

  return { install, isInstalling: fetcher.state !== "idle" };
}
