import {
  ONSHAPE_INTEGRATION_ID,
  type OnshapeIntegrationId
} from "./connection";

/**
 * The panel runs as its own integration, beside the sync connections in
 * `./connection`.
 *
 * `onshape` (or `onshape-government`) is the pull-shaped one: Carbon lists
 * documents, pulls models, and a webhook attaches assets when Onshape releases.
 * `onshape-v2` is the panel — push-only, driven from inside Onshape by the
 * person who decides when CAD data should land in Carbon.
 *
 * They are separate integrations rather than two modes of one because they own
 * separate state: each has its own OAuth grant and credential row, and each
 * writes its own `externalIntegrationMapping` namespace. A company can install
 * either, both, or neither, and uninstalling one never disturbs the other. The
 * one-connection-at-a-time rule in `./connection` is between the two sync
 * connections only; the panel is not one of them.
 *
 * The pair is expected to be temporary — v2 is intended to replace v1 — but
 * while both are installable, every read that answers "does Carbon know about
 * this Onshape thing?" has to consider both namespaces, and every write has to
 * name exactly one. An `"onshape"` string literal in panel code is almost
 * always a bug now.
 */
export const ONSHAPE_V2_INTEGRATION_ID = "onshape-v2";

export type OnshapeV2IntegrationId = typeof ONSHAPE_V2_INTEGRATION_ID;

/**
 * Every Onshape integration that holds an OAuth grant of its own: the company's
 * sync connection (public app or Government private app) and the panel.
 */
export type OnshapeOAuthIntegrationId =
  | OnshapeIntegrationId
  | OnshapeV2IntegrationId;

/**
 * An `externalIntegrationMapping` namespace an Onshape link can live in. Both
 * sync connections write under `onshape` (see `./connection`); the panel writes
 * under its own id.
 */
export type OnshapeMappingNamespace =
  | typeof ONSHAPE_INTEGRATION_ID
  | OnshapeV2IntegrationId;

/**
 * Both namespaces, for reads that must see an item however it was linked —
 * the item page's source card, and anything answering "is this already in
 * Carbon?". Order matters where a single row is picked: v2 first, because a
 * company running both is migrating toward it.
 */
export const ONSHAPE_MAPPING_NAMESPACES: readonly OnshapeMappingNamespace[] = [
  ONSHAPE_V2_INTEGRATION_ID,
  ONSHAPE_INTEGRATION_ID
];

export function isOnshapeMappingNamespace(
  value: unknown
): value is OnshapeMappingNamespace {
  return (
    value === ONSHAPE_INTEGRATION_ID || value === ONSHAPE_V2_INTEGRATION_ID
  );
}
