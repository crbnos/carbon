import { useIntegrations } from "./useIntegrations";

/**
 * The company's Onshape connection, for deciding what to RENDER.
 *
 * Presentation only. Every Onshape route re-reads its settings server-side and
 * refuses when the integration is not connected, so this hiding or showing a
 * button is never what keeps a surface off a company that has not connected.
 */
export function useOnshape(): {
  isConnected: boolean;
  allowUnreleasedSync: boolean;
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
    // Presentation only: whether to OFFER unreleased versions. The versions
    // route re-reads it server-side and refuses regardless.
    allowUnreleasedSync:
      isConnected &&
      (metadata.allowUnreleasedSync === true ||
        metadata.allowUnreleasedSync === "true")
  };
}
