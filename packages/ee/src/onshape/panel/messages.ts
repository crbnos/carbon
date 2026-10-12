// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The Onshape iframe contract: context arrives as query parameters, messages
// over postMessage, and every Onshape message must come from the `server`
// origin the panel was loaded with. Client-safe: no server imports.

/** cad.onshape.com, enterprise `<name>.onshape.com`, and Onshape's dev stacks. */
const ONSHAPE_SERVER_PATTERN = /^https:\/\/([a-z0-9-]+\.)*onshape\.com$/i;

export function isOnshapeServerOrigin(value: unknown): value is string {
  return typeof value === "string" && ONSHAPE_SERVER_PATTERN.test(value);
}

/** The query parameters the dev-portal action URL asks Onshape to substitute. */
export type OnshapePanelContext = {
  documentId: string | null;
  /** `w` workspace, `v` version, `m` microversion. */
  wv: "w" | "v" | "m" | null;
  wvId: string | null;
  elementId: string | null;
  partNumber: string | null;
  revision: string | null;
  nodeId: string | null;
  occurrencePath: string | null;
  configuration: string | null;
  /** Appended by Onshape itself. */
  companyId: string | null;
  userId: string | null;
  locale: string | null;
  clientId: string | null;
};

function param(searchParams: URLSearchParams, name: string) {
  const value = searchParams.get(name);
  if (value === null) return null;
  const trimmed = value.trim();
  // Onshape sends an unresolved parameter as its literal placeholder
  // (`{$partNumber}` with nothing selected) or as the empty string.
  if (trimmed === "" || /^\{\$[A-Za-z]+\}$/.test(trimmed)) return null;
  return trimmed;
}

export function parsePanelContext(searchParams: URLSearchParams): {
  context: OnshapePanelContext;
  serverOrigin: string | null;
} {
  const wv = param(searchParams, "wv");
  const server = param(searchParams, "server");

  return {
    context: {
      documentId: param(searchParams, "documentId"),
      wv: wv === "w" || wv === "v" || wv === "m" ? wv : null,
      wvId: param(searchParams, "wvId"),
      elementId: param(searchParams, "elementId"),
      partNumber: param(searchParams, "partNumber"),
      revision: param(searchParams, "revision"),
      nodeId: param(searchParams, "nodeId"),
      occurrencePath: param(searchParams, "occurrencePath"),
      configuration: param(searchParams, "configuration"),
      companyId: param(searchParams, "companyId"),
      userId: param(searchParams, "userId"),
      locale: param(searchParams, "locale"),
      clientId: param(searchParams, "clientId")
    },
    // Anything else means Onshape did not open the page.
    serverOrigin: isOnshapeServerOrigin(server) ? server : null
  };
}

/** Sent once the panel is ready; Onshape sends SELECTION after it. */
export function postApplicationInit(
  context: OnshapePanelContext,
  serverOrigin: string
) {
  window.parent.postMessage(
    {
      documentId: context.documentId,
      workspaceId: context.wvId,
      elementId: context.elementId,
      messageName: "applicationInit"
    },
    serverOrigin
  );
}

/** A message from the Onshape client. Only `messageName` is guaranteed. */
export type OnshapeClientMessage = { messageName: string } & Record<
  string,
  unknown
>;

export function isOnshapeClientMessage(
  data: unknown
): data is OnshapeClientMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as Record<string, unknown>).messageName === "string"
  );
}

/** The auth popup posts the panel session token with this; same origin only. */
export const PANEL_SESSION_MESSAGE = "carbon_onshape_panel_session" as const;

export type PanelSessionMessage = {
  type: typeof PANEL_SESSION_MESSAGE;
  token: string;
};

export function isPanelSessionMessage(
  data: unknown
): data is PanelSessionMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === PANEL_SESSION_MESSAGE &&
    typeof (data as Record<string, unknown>).token === "string"
  );
}
