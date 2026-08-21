import { datetime } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMatches } from "react-router";
import type { Handle } from "~/utils/handle";

// A document the user opened. Everything here is derived from the route's own
// `detailBreadcrumb` handle at view time, so nothing has to be kept in sync with
// a hand-maintained route list:
//  - `title`     the entity's readable id (last breadcrumb segment)
//  - `typeLabel` the list-link label the route already declares (e.g. "Orders")
//  - `module`    the route's `handle.module`, resolved to an icon at display time
//                against the `useModules` registry
// `url` is the canonical detail path (link target + de-dupe key); `viewedAt` a
// UTC instant string.
export type RecentDocument = {
  url: string;
  title: string;
  typeLabel: string;
  module: string;
  viewedAt: string;
};

// Up to this many recents are kept. The home page shows the same number.
export const RECENT_MAX = 8;

// Per-user, per-browser. Not shared state, so it lives in localStorage — same
// rationale as `useHubDismissed`. Scoped by company so switching tenants shows
// the right history.
const storageKey = (companyId: string) => `recentlyViewed:${companyId}`;
// Same-tab reader sync: writing to localStorage does not fire `storage` in the
// tab that wrote it, so we broadcast our own event too.
const RECENT_EVENT = "carbon:recentlyViewed";

function readRecent(companyId: string): RecentDocument[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentDocument[]) : [];
  } catch {
    return [];
  }
}

function writeRecent(companyId: string, docs: RecentDocument[]) {
  try {
    window.localStorage.setItem(storageKey(companyId), JSON.stringify(docs));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    // ignore (private mode / storage disabled)
  }
}

function recordRecentlyViewed(
  companyId: string,
  doc: Omit<RecentDocument, "viewedAt">
) {
  const existing = readRecent(companyId);
  const next = [
    { ...doc, viewedAt: datetime.timestamp() },
    ...existing.filter((d) => d.url !== doc.url)
  ].slice(0, RECENT_MAX);
  writeRecent(companyId, next);
}

// A breadcrumb label is either a plain string or a Lingui MessageDescriptor
// (from `msg`...``); resolve either to a display string. Mirrors the resolver in
// the Topbar Breadcrumbs component.
function resolveLabel(
  value: unknown,
  i18n: ReturnType<typeof useLingui>["i18n"]
): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return i18n._(value as { id: string; message?: string });
  }
  return "";
}

// Mounted once in the authenticated shell. Watches the active route matches and,
// whenever the current page is a resolved detail document, records it. Reads the
// title, type label, and module straight from the route's `detailBreadcrumb`
// handle — no per-route wiring, so a new detail route that follows the standard
// handle convention is picked up automatically. Skips while loading — an
// unresolved breadcrumb has only the list segment (no string entity id yet).
export function useRecordRecentlyViewed(companyId: string | null | undefined) {
  const matches = useMatches();
  const { i18n } = useLingui();

  const detail = useMemo<Omit<RecentDocument, "viewedAt"> | null>(() => {
    for (const m of matches) {
      const handle = m.handle as Handle | undefined;
      if (!handle || typeof handle.breadcrumb !== "function") continue;
      const module =
        typeof handle.module === "string" ? handle.module : undefined;
      if (!module) continue;

      // A detail route resolves to [listLink, { breadcrumb: entityId }]; a list
      // route resolves to a single segment. Only the former is a document.
      const resolved = handle.breadcrumb(m.params, m.data);
      if (!Array.isArray(resolved) || resolved.length < 2) continue;

      const last = resolved[resolved.length - 1];
      const title =
        last && typeof last.breadcrumb === "string"
          ? last.breadcrumb
          : undefined;
      if (!title) continue;

      const typeLabel = resolveLabel(resolved[0]?.breadcrumb, i18n);
      return { url: m.pathname, title, typeLabel, module };
    }
    return null;
  }, [matches, i18n]);

  const url = detail?.url;
  const title = detail?.title;
  const typeLabel = detail?.typeLabel;
  const module = detail?.module;

  useEffect(() => {
    if (!companyId || !url || !title || !module) return;
    recordRecentlyViewed(companyId, {
      url,
      title,
      typeLabel: typeLabel ?? "",
      module
    });
  }, [companyId, url, title, typeLabel, module]);
}

// Reader for the home page. Stays in sync with the recorder in the same tab via
// the custom event, and across tabs via `storage`.
export function useRecentlyViewed(companyId: string | null | undefined) {
  const [documents, setDocuments] = useState<RecentDocument[]>([]);

  useEffect(() => {
    if (!companyId) {
      setDocuments([]);
      return;
    }
    const sync = () => setDocuments(readRecent(companyId));
    sync();
    window.addEventListener(RECENT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(RECENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [companyId]);

  const remove = useCallback(
    (url: string) => {
      if (!companyId) return;
      const next = readRecent(companyId).filter((d) => d.url !== url);
      writeRecent(companyId, next);
      setDocuments(next);
    },
    [companyId]
  );

  return { documents, remove };
}
