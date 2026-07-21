import { path } from "~/utils/path";

// The navigation manifest. Built once from `path.to` — the single source of truth for every
// URL in the app — so the agent can reach ANY page without a hand-maintained destination list.
// The model discovers pages with `find_page` (like it discovers docs/tools), then calls
// `navigate` with the chosen `key`. As the app grows, this manifest grows with it.

export type NavigablePage = {
  key: string; // the `path.to` key the client resolves against
  url: string; // sample URL; dynamic segments render as ":id"
  arity: number; // required args (usually a record id) navigate must supply, in order
  label: string; // humanized key, e.g. "getStarted" → "Get Started"
};

// Routes we never land a user on, even under /x: these mutate or are transient actions,
// not viewable pages. We err toward excluding. The verb list is grounded in the app's
// actual action-only route files (no default export) — see the trailing segments of
// `apps/erp/app/routes/x+/**` handlers. Only unambiguous action verbs are listed; nouns
// that also name real pages (order, status, operation, payment, …) are deliberately left
// out so we don't hide viewable pages.
//
// NOTE: this is still a denylist, so a brand-new action verb leaks until added here. The
// fail-closed fix is a build-time manifest of routes that actually export a page component;
// until that exists, keep this list in sync when adding action-only routes.
const ACTION =
  /(^|\/)(new|edit|delete|remove|duplicate|import|export|activate|deactivate|update|post|unpost|void|finalize|cancel|complete|confirm|convert|favorite|unfavorite|acknowledge|assign|unassign|approve|reject|submit|reopen|restore|archive|unarchive|split|adjust|save|send|release|receive|delivery)($|\/|\?)/i;

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

// Only real /x page routes survive: /api endpoints, /file PDFs, nested groups, and mutating
// routes are all dropped programmatically — nothing here is re-listed by hand.
export const PAGES: NavigablePage[] = Object.entries(
  path.to as Record<string, unknown>
).flatMap(([key, val]) => {
  if (typeof val !== "string" && typeof val !== "function") return [];
  const arity = typeof val === "function" ? val.length : 0;
  let url: string;
  try {
    url =
      typeof val === "function"
        ? (val as (...a: string[]) => string)(...Array(arity).fill(":id"))
        : val;
  } catch {
    return [];
  }
  if (typeof url !== "string" || !url.startsWith("/x/") || ACTION.test(url)) {
    return [];
  }
  return [{ key, url, arity, label: humanize(key) }];
});

const PAGE_BY_KEY = new Map(PAGES.map((p) => [p.key, p]));

// Fuzzy-search the manifest so the model can pick a page. Scores by how many query words
// appear in the key/url/label, with a bonus for an exact key hit.
export function findPages(query: string, limit = 8): NavigablePage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const q = query.toLowerCase();
  return PAGES.map((p) => {
    const hay = `${p.key} ${p.url} ${p.label}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += 1;
    if (p.key.toLowerCase() === q) score += 5;
    return { p, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.p);
}

// Resolve a chosen page + params to a real URL. Returns null when the key isn't an
// allowlisted page or required args are missing — the client no-ops rather than sending
// the user somewhere broken or unsafe (the model can't emit a raw URL, only a known key).
export function resolvePage(key: string, params: string[] = []): string | null {
  const page = PAGE_BY_KEY.get(key);
  if (!page || params.length < page.arity) return null;
  const val = (path.to as Record<string, unknown>)[key];
  if (typeof val === "function") {
    return (val as (...a: string[]) => string)(...params.slice(0, page.arity));
  }
  return typeof val === "string" ? val : null;
}
