import { useIntegrations } from "./useIntegrations";

/**
 * Which Onshape pipeline this company runs, for deciding what to RENDER.
 *
 * Presentation only. Every v2 route re-reads the setting server-side via
 * `getOnshapeV2Settings` and refuses when it is not enabled, so this hook
 * hiding or showing a button is never what keeps v2 off a legacy company.
 *
 * Mirrors the server's strict equality: anything that is not exactly "next"
 * is legacy, so an absent key on an existing install can never read as v2.
 */
export function useOnshapePipeline(): {
  isConnected: boolean;
  isV2: boolean;
} {
  const integrations = useIntegrations();

  const onshape = integrations.list.find(
    (integration) => integration.id === "onshape"
  );

  const isConnected = onshape?.active === true;

  const metadata =
    onshape?.metadata && typeof onshape.metadata === "object"
      ? (onshape.metadata as Record<string, unknown>)
      : {};

  return {
    isConnected,
    isV2: isConnected && metadata.pipeline === "next"
  };
}
