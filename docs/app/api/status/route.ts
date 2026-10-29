// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Checkmate's public status-page payload for status.carbon.ms. It sends no CORS
// headers, so the footer reads it through this route rather than from the browser.
const STATUS_URL =
  "https://status.carbon.ms/api/v1/status-page/resolve?domain=status.carbon.ms&type=uptime";

export const revalidate = 60;

export async function GET() {
  try {
    const res = await fetch(STATUS_URL, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { data?: { monitors?: { status: string }[] } };
    const monitors = json.data?.monitors;
    if (!res.ok || !monitors) return Response.json({ up: false });
    return Response.json({ up: monitors.every((m) => m.status !== "down") });
  } catch {
    return Response.json({ up: false });
  }
}
