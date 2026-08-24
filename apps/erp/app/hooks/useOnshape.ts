import { useIntegrations } from "./useIntegrations";

/**
 * The company's Onshape connection, for deciding what to RENDER.
 *
 * Presentation only. Every Onshape route re-reads its settings server-side and
 * refuses when the integration is not connected, so this hiding or showing a
 * button is never what keeps a surface off a company that has not connected.
 */
export function useOnshape(): { isConnected: boolean } {
  const integrations = useIntegrations();

  return {
    isConnected:
      integrations.list.find((integration) => integration.id === "onshape")
        ?.active === true
  };
}
