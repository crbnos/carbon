// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * What did the operator just scan?
 *
 * Three things come off a shop-floor barcode: a Carbon URL printed on a
 * traveller or a kanban card, a part or serial code printed on a label, and
 * junk. This decides which, and nothing else — no navigation, no lookups, no
 * React. That is why it is the one piece of the scan path with real tests.
 *
 * Web MES's wedge (`packages/react/src/hooks/useKeyboardWedge.ts`) does the
 * equivalent by taking any `http…` scan, throwing the host away and navigating
 * to `pathname + search` on whatever Carbon the browser is already on. A
 * browser tab is pinned to one instance so that is nearly harmless there. A
 * tablet is not: it holds a list of linked Carbons, and a QR code printed by a
 * DIFFERENT install carries ids that mean nothing here. See
 * `"other-instance"` below.
 */

/** The four routes a scannable Carbon QR code points at (`apps/mes/app/utils/path.ts`). */
const SCAN_ROUTES = ["operation", "start", "end", "picking"] as const;

export type ScanRoute = (typeof SCAN_ROUTES)[number];

export type ScanResult =
  /** A Carbon route on the linked instance. The caller navigates. */
  | { kind: "url"; route: ScanRoute; id: string }
  /**
   * A Carbon route on some OTHER host. Deliberately NOT a `"url"`: following
   * it would send the operator at another company's work, and its id would
   * only 404 against this instance anyway — a confusing dead end rather than
   * an answer. Deliberately not a `"code"` either, because "nothing matches"
   * would send them hunting for a typo in a code that is perfectly valid
   * somewhere else. The screen says which host it came from.
   */
  | { kind: "other-instance"; host: string; value: string }
  /** Anything else: a serial, a lot, an item id, a kanban barcode, junk. */
  | { kind: "code"; value: string };

const ABSOLUTE_URL = /^https?:\/\//i;

/**
 * Only used to let `URL` parse a bare path like `/x/start/abc` — a relative
 * URL needs some base, and this one is never read back out.
 */
const RELATIVE_BASE = "http://scan.invalid";

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The Carbon route a scan points at, or null when it is not one.
 *
 * `host` is null for a bare path — there is no host to disagree with, and the
 * only instance it can mean is the linked one.
 */
function carbonRoute(
  value: string
): { route: ScanRoute; id: string; host: string | null } | null {
  let url: URL;
  let host: string | null;

  if (ABSOLUTE_URL.test(value)) {
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    // `URL.host` keeps a non-default port and drops a default one, which is
    // what we want: staging on :3002 is a different instance from production
    // on :3001, while `https://host:443` and `https://host` are the same one.
    host = url.host.toLowerCase();
  } else {
    if (!value.startsWith("/")) return null;
    try {
      url = new URL(value, RELATIVE_BASE);
    } catch {
      return null;
    }
    host = null;
  }

  // `filter(Boolean)` absorbs a trailing slash and a doubled one; the query
  // string and fragment are already off in `pathname`. The length check is
  // what keeps a deeper path out — `/x/picking/:id/line/quantity` is a web
  // form action, not something anybody prints on a label.
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 3) return null;

  const [prefix, route, id] = segments;
  if (prefix !== "x" || !id) return null;
  if (!SCAN_ROUTES.includes(route as ScanRoute)) return null;

  return { route: route as ScanRoute, id, host };
}

/**
 * `linkedServerUrl` is the linked instance's origin (`useAuth().serverUrl`).
 * It is a required argument rather than an option so that a caller cannot
 * forget the host check and silently reintroduce the cross-instance jump. Pass
 * null when no instance is linked: a bare path still resolves (it can only
 * mean the linked Carbon), and an absolute URL cannot be confirmed as ours, so
 * it comes back as `"other-instance"`.
 *
 * The scheme is NOT compared. A reverse proxy terminating TLS, or a dev server
 * linked over http and printing https URLs, is the same Carbon.
 */
export function parseScan(
  text: string,
  linkedServerUrl: string | null
): ScanResult {
  // Scanners in keyboard mode append CR/LF, and a camera read can carry
  // leading space. The trimmed value is what the lookup gets too.
  const value = text.trim();

  const route = carbonRoute(value);
  if (!route) return { kind: "code", value };

  if (route.host !== null && route.host !== hostOf(linkedServerUrl)) {
    return { kind: "other-instance", host: route.host, value };
  }

  return { kind: "url", route: route.route, id: route.id };
}
