/**
 * Opening a vendor's consent screen, from wherever an account is connected — the
 * integration card's Install button and the Accounts tab's "Add account".
 *
 * Browser-only, and deliberately not per-vendor: the route the caller names returns
 * `{ url }` (or `{ error }`) and everything after that is identical for every piece.
 * Sharing it is what stops the two entry points drifting into different popup sizes
 * and different failure behaviour.
 */
export type ConnectRouteResponse = { url?: string; error?: string };

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 800;

/** Centred on the window the user is actually looking at, not on screen 0. */
function popupFeatures(): string {
  const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
  const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2.5;
  return `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${POPUP_WIDTH}, height=${POPUP_HEIGHT}, top=${top}, left=${left}`;
}

/** Opens a consent URL, falling back to a full navigation when the popup is blocked. */
export function openConsentPopup(url: string): void {
  const popup = window.open(url, "", popupFeatures());
  if (!popup) window.location.href = url;
}

/**
 * Asks a connect route for its consent URL and opens it.
 *
 * Throws the route's own `error` when it has one — that message is written for a
 * customer (see `integrations.connections.$piece.connect.ts`), so a caller can show
 * it as-is.
 */
export async function startIntegrationConnect(
  connectUrl: string
): Promise<void> {
  const response = await fetch(connectUrl);
  const { url, error }: ConnectRouteResponse = await response.json();

  if (!url) {
    throw new Error(error ?? "Couldn't start the authorization.");
  }
  openConsentPopup(url);
}
