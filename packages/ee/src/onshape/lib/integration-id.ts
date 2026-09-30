import type { OnshapeIntegrationId } from "./connection";

/**
 * The panel runs as its own integration, beside the sync connections in
 * `./connection`.
 *
 * `onshape` (or `onshape-government`) is the pull-shaped one: Carbon lists
 * documents, pulls models, and a webhook attaches assets when Onshape releases.
 * `onshape-v2` is the panel — push-only, driven from inside Onshape.
 *
 * They are separate integrations rather than two modes of one because they own
 * separate state: each has its own OAuth grant and credential row, and each
 * writes its own `externalIntegrationMapping` namespace. The
 * one-connection-at-a-time rule in `./connection` is between the two sync
 * connections only.
 *
 * An item linked by the panel is linked under `onshape-v2` only. A sync
 * connection's `onshape` row is BOM-import bookkeeping and never means Onshape
 * owns the item, so the item lock, its card and Detach read `onshape-v2` alone.
 * An `"onshape"` string literal in panel code is almost always a bug.
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
