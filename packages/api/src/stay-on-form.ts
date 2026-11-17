// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

const pathOf = (url: string) =>
  new URL(url).pathname.replace(/\.data$/, "").replace(/(.)\/$/, "$1");

/**
 * Whether a refused save can stay where it was posted: a POST (not a loader)
 * from the page that owns the action, whose form is then still on screen. A
 * button that posts to an action-only route (Receive posts to the new receipt
 * route) would land on a blank page, so it goes back as before.
 */
export function staysOnForm(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return pathOf(referer) === pathOf(request.url);
  } catch {
    return false;
  }
}
