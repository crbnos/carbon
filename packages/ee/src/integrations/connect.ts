// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beginOAuthPopup } from "../oauth-popup";

/**
 * Opening a vendor's consent screen, from wherever an account is connected — the
 * integration card's Install button and the Accounts tab's "Add account".
 *
 * Browser-only, and deliberately not per-vendor: the route the caller names returns
 * `{ url }` (or `{ error }`, a code) and everything after that is identical for every
 * piece. Sharing it is what stops the two entry points drifting into different
 * failure behaviour.
 */
export type ConnectRouteResponse = { url?: string; error?: string };

/** The connect route refused, or could not be reached. `code` is one of the
 * `connection` codes in the ERP's `integration-errors.ts`, which words it. */
export class IntegrationConnectError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Integration connect failed: ${code}`);
    this.code = code;
    this.name = "IntegrationConnectError";
  }
}

/**
 * Asks a connect route for its consent URL and opens it.
 *
 * Call it synchronously from the click: the popup opens before the fetch, because
 * Chrome blocks a `window.open` made after an await. Throws an
 * `IntegrationConnectError` carrying the route's code when there is no URL.
 */
export async function startIntegrationConnect(
  connectUrl: string
): Promise<void> {
  const popup = beginOAuthPopup();
  let body: ConnectRouteResponse;
  try {
    const response = await fetch(connectUrl);
    body = await response.json();
  } catch {
    popup.close();
    throw new IntegrationConnectError("unexpected");
  }
  if (!body.url) {
    popup.close();
    throw new IntegrationConnectError(body.error ?? "unexpected");
  }
  popup.navigate(body.url);
}
