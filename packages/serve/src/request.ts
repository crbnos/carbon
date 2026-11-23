// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

/**
 * A Node request as the Fetch `Request` React Router takes.
 *
 * The URL is the one the app was called on: host from the `Host` header,
 * scheme from the socket. It is joined as text and never resolved against
 * a base — resolved, a path of `//other.host/x` names another host, and
 * React Router checks a form's `Origin` against this URL. That is why this
 * is not `@mjackson/node-fetch-server`, which resolves.
 */
export function toFetchRequest(
  raw: IncomingMessage,
  signal: AbortSignal
): Request {
  const scheme =
    "encrypted" in raw.socket && raw.socket.encrypted ? "https" : "http";
  const url = `${scheme}://${raw.headers.host ?? "localhost"}${raw.url ?? "/"}`;

  const headers = new Headers();
  for (let i = 0; i < raw.rawHeaders.length; i += 2) {
    headers.append(raw.rawHeaders[i] ?? "", raw.rawHeaders[i + 1] ?? "");
  }

  if (raw.method === "GET" || raw.method === "HEAD") {
    return new Request(url, { method: raw.method, headers, signal });
  }
  return new Request(url, {
    method: raw.method,
    headers,
    signal,
    // The body is handed over unread, as a stream. Node's stream type and
    // the DOM's disagree on a detail of byte readers; at runtime they are
    // the one class.
    body: Readable.toWeb(raw) as unknown as BodyInit,
    duplex: "half"
  } as RequestInit);
}
