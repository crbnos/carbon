// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Where Postgres posts its Inngest events (`util.send_inngest_event`), from the
 * same variables the Inngest SDK reads: `${base}e/${eventKey}`. Null when
 * neither is set. `INNGEST_DATABASE_EVENT_URL` wins when set: the database may
 * reach Inngest at a different address than the app does.
 */
export function resolveInngestEventUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  if (env.INNGEST_DATABASE_EVENT_URL) return env.INNGEST_DATABASE_EVENT_URL;
  const eventKey = env.INNGEST_EVENT_KEY;
  const baseUrl = env.INNGEST_EVENT_API_BASE_URL || env.INNGEST_BASE_URL;
  if (!eventKey && !baseUrl) return null;
  return new URL(
    `e/${eventKey || "NO_EVENT_KEY_SET"}`,
    baseUrl || "https://inn.gs/"
  ).href;
}
