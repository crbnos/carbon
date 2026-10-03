// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Where Postgres posts its Inngest events (`util.send_inngest_event`), from the
 * same variables the Inngest SDK reads: `${base}e/${eventKey}`. Null when
 * neither is set.
 */
export function resolveInngestEventUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  const eventKey = env.INNGEST_EVENT_KEY;
  const baseUrl = env.INNGEST_EVENT_API_BASE_URL || env.INNGEST_BASE_URL;
  if (!eventKey && !baseUrl) return null;
  return new URL(
    `e/${eventKey || "NO_EVENT_KEY_SET"}`,
    baseUrl || "https://inn.gs/"
  ).href;
}
