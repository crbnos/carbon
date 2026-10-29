// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure request-security decisions shared by every app. No env or I/O here, so the
// rules are unit-tested as plain functions; the middleware in
// ../middleware/security.server.ts wires them to requests.

import { getRequestHost } from "@carbon/utils";

type HeaderReader = Pick<Headers, "get">;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Endpoints browsers call from other origins by design: MCP clients register,
 * exchange tokens and talk to the MCP transport from wherever they run. None of
 * them reads the session cookie.
 */
const CROSS_ORIGIN_ENDPOINTS = ["/token", "/register", "/api/mcp"];

/**
 * CSRF check for a state-changing request (the algorithm of Go's
 * `http.CrossOriginProtection`). Browsers always send `Sec-Fetch-Site` or
 * `Origin` on a cross-origin POST; servers (webhooks, Inngest, the assembler,
 * API-key clients) send neither and are not relying on our cookies.
 *
 * `same-site` is refused on purpose: the session cookie is set on the parent
 * domain, so every `*.carbon.ms` host is same-site to the ERP.
 */
export function isCrossOriginRequestAllowed(
  method: string,
  pathname: string,
  headers: HeaderReader
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;

  // Browser submissions arrive as React Router single-fetch `…/path.data`.
  const path = pathname.replace(/\.data$/, "").replace(/(.)\/$/, "$1");
  if (CROSS_ORIGIN_ENDPOINTS.includes(path)) return true;

  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";

  const origin = headers.get("origin");
  if (!origin) return true;

  // The host the browser addressed, never `request.url`'s (the internal origin
  // behind the proxy).
  const host = getRequestHost({ headers });
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    // `Origin: null` (sandboxed documents, privacy redirects).
    return false;
  }
}

/**
 * A top-level navigation started on another site. A loader that writes on GET
 * (the kanban QR flow, MES start/end) refuses these: a scanned QR code or typed
 * URL is `none`, and the ERP→MES redirect is `same-site`.
 */
export function isCrossSiteNavigation(headers: HeaderReader): boolean {
  return headers.get("sec-fetch-site") === "cross-site";
}

export function createNonce(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))
  );
}

type Directive =
  | "default-src"
  | "script-src"
  | "style-src"
  | "img-src"
  | "font-src"
  | "connect-src"
  | "frame-src"
  | "worker-src"
  | "media-src"
  | "object-src"
  | "base-uri"
  | "frame-ancestors";

export type ContentSecurityPolicyOptions = {
  nonce: string;
  /** Browser Supabase URL: REST, storage and realtime (ws/wss). */
  supabaseUrl?: string;
  posthogHost?: string;
  /** `new Function` in the ERP configurator; remove with that follow-up. */
  allowEval?: boolean;
  /** Extra sources per directive (e.g. Google Fonts for academy). */
  extra?: Partial<Record<Directive, string[]>>;
  reportUri?: string;
};

const originOf = (url: string | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * The strict app policy: scripts run only when they carry this response's nonce
 * or are loaded by one that does ('strict-dynamic'), so injected markup cannot
 * run script. Why each exception exists is in .ai/plans/2026-09-28-csp-csrf.md.
 */
export function buildContentSecurityPolicy({
  nonce,
  supabaseUrl,
  posthogHost,
  allowEval = false,
  extra = {},
  reportUri
}: ContentSecurityPolicyOptions): string {
  const supabase = originOf(supabaseUrl);
  const posthog = originOf(posthogHost);

  const directives: Record<Directive, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      ...(allowEval ? ["'unsafe-eval'"] : []),
      // Ignored by CSP3 browsers (nonce + strict-dynamic win); the fallback for
      // older ones.
      "https:",
      "'unsafe-inline'"
    ],
    "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:", "https://cdn.jsdelivr.net"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase, supabase.replace(/^http/, "ws")] : []),
      ...(posthog
        ? new URL(posthog).hostname.endsWith("posthog.com")
          ? ["https://*.posthog.com"]
          : [posthog]
        : []),
      "https://places.googleapis.com",
      "https://cdn.jsdelivr.net"
    ],
    "frame-src": [
      "'self'",
      "blob:",
      "data:",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      "https://www.loom.com",
      "https://challenges.cloudflare.com"
    ],
    "worker-src": ["'self'", "blob:", "data:"],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "frame-ancestors": ["'self'"]
  };
  for (const [name, sources] of Object.entries(extra)) {
    directives[name as Directive].push(...(sources ?? []));
  }

  const policy = Object.entries(directives).map(
    ([name, sources]) => `${name} ${[...new Set(sources)].join(" ")}`
  );
  if (reportUri) policy.push(`report-uri ${reportUri}`);
  return policy.join("; ");
}
