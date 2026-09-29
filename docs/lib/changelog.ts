// Entry dates are formatted from their YYYY-MM-DD parts, never through a JS
// Date, so every timezone sees the date the entry was written with.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "2026-09-04" → "September 4, 2026". */
export function formatChangelogDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

// "2026-09-04" → "04 Sep 2026 00:00:00 GMT" (RFC 822, for RSS).
export function rfc822Date(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = String(d).padStart(2, "0");
  return `${day} ${MONTHS[(m ?? 1) - 1].slice(0, 3)} ${y} 00:00:00 GMT`;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const CHANGELOG_PAGE_SIZE = 10;

export const RSS_ITEM_LIMIT = 20;

export function changelogPagePath(page: number): string {
  return page <= 1 ? "/changelog" : `/changelog/page/${page}`;
}

// `page` is 1-based; out of range yields nothing, which the route turns into a 404.
export function paginateChangelog<T>(
  entries: T[],
  page: number
): { entries: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(entries.length / CHANGELOG_PAGE_SIZE));
  const start = (page - 1) * CHANGELOG_PAGE_SIZE;
  return {
    entries: entries.slice(start, start + CHANGELOG_PAGE_SIZE),
    page,
    pageCount
  };
}
