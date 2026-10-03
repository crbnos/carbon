// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Turning what a supervisor gives us into a server address.
 *
 * Carbon is not one server. Carbon Cloud is several deployments, every BYOC
 * customer runs their own cluster on their own domain, a customer may run
 * staging beside production, and some installs are air-gapped and will never
 * tell us they exist. There is one store build for all of them, so the app is
 * TOLD which Carbon to use — by QR code, or by typing an address.
 */

/** Carbon Cloud's MES, offered as a button and never as a default. */
export const CARBON_CLOUD_URL = "https://mes.carbon.ms";

/** The custom scheme the QR code uses; registered to the app at build time. */
export const LINK_SCHEME = "carbon-mes";

export type ResolvedAddress = {
  /** The origin to call `/api/v1` on. No path, no query. */
  url: string;
  scheme: "https" | "http";
  /** True when the address was typed bare and we guessed `https`. */
  guessedScheme: boolean;
};

function origin(url: URL): string {
  // Everything after the origin is dropped: a QR code or a pasted link may
  // carry a path, and the API prefix is appended by the client.
  return url.origin;
}

/**
 * Accepts, in order of preference:
 *   - `carbon-mes://link?server=<encoded url>` — what web Carbon's QR encodes
 *   - a full `http(s)://host[:port][/path]` URL — used as given, path dropped
 *   - a bare host
 *
 * A bare host resolves with the BYOC convention, `mes.` under the domain
 * (`byoc docs/domains.md`), unless it already starts with `mes.` — a supervisor
 * reading the address off their own browser is the common case, and
 * `mes.mes.acme.com` would be a confusing failure.
 */
export function resolveServerAddress(input: string): ResolvedAddress | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith(`${LINK_SCHEME}:`)) {
    let link: URL;
    try {
      link = new URL(trimmed);
    } catch {
      return null;
    }
    const server = link.searchParams.get("server");
    return server ? resolveServerAddress(server) : null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!url.hostname) return null;
      return {
        url: origin(url),
        scheme: url.protocol === "http:" ? "http" : "https",
        guessedScheme: false
      };
    } catch {
      return null;
    }
  }

  // A bare host. Reject anything that is clearly not one before guessing.
  const host = trimmed.replace(/\/+$/, "");
  if (/[\s/?#]/.test(host) || !/[a-z0-9]/i.test(host)) return null;

  const [hostname] = host.split(":");
  if (!hostname) return null;

  const withSubdomain =
    hostname.toLowerCase().startsWith("mes.") || hostname.includes("localhost")
      ? host
      : `mes.${host}`;

  try {
    const url = new URL(`https://${withSubdomain}`);
    return { url: origin(url), scheme: "https", guessedScheme: true };
  } catch {
    return null;
  }
}

/**
 * The schemes to try, in order. A bare single-node BYOC install has no
 * certificate (`byoc internal/environment/deploy.go` `Scheme`), so `https`
 * first and then `http` — and the sign-in screen warns on `http`.
 */
export function probeOrder(resolved: ResolvedAddress): string[] {
  if (!resolved.guessedScheme) return [resolved.url];
  return [resolved.url, resolved.url.replace(/^https:/, "http:")];
}

/** What the sign-in screen shows so a malicious QR cannot hide the host. */
export function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
