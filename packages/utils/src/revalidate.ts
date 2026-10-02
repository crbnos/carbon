// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * True when a navigation only changed the search params of the page we are
 * already on — a table filter, sort, page, or drawer toggle.
 *
 * These are by far the most frequent navigations in the app, and none of them
 * can change app-shell data: no mutation ran and the route didn't change. So a
 * shell-level `shouldRevalidate` can skip them.
 *
 * Note what this does NOT cover: `useRevalidator().revalidate()` (how the
 * realtime hooks refresh) also presents as same-pathname with no form method,
 * so a shell loader using this will not re-run for realtime events either.
 * Leaf loaders still refresh, which is the intent — but shell data that must
 * react to a realtime change needs its own path in `shouldRevalidate`.
 */
export function isSearchParamOnlyNavigation({
  currentUrl,
  nextUrl,
  formMethod
}: {
  currentUrl: URL;
  nextUrl: URL;
  formMethod?: string;
}) {
  if (formMethod && formMethod !== "GET") return false;
  return currentUrl.pathname === nextUrl.pathname;
}

/**
 * True when a GET navigation left the route params and search params a layout
 * loader reads unchanged (`search: "all"` for one that reads the whole query
 * string). Single fetch otherwise re-runs every matched loader on every
 * navigation. Mutations and `useRevalidator().revalidate()` are never
 * "unaffected".
 */
export function isUnaffectedByNavigation(
  {
    currentUrl,
    nextUrl,
    currentParams,
    nextParams,
    formMethod
  }: {
    currentUrl: URL;
    nextUrl: URL;
    currentParams: Record<string, string | undefined>;
    nextParams: Record<string, string | undefined>;
    formMethod?: string;
  },
  reads: { params?: string[]; search?: string[] | "all" } = {}
) {
  if (formMethod && formMethod !== "GET") return false;
  if (currentUrl.href === nextUrl.href) return false;
  const { params = [], search = [] } = reads;
  if (!params.every((key) => currentParams[key] === nextParams[key])) {
    return false;
  }
  if (search === "all") return currentUrl.search === nextUrl.search;
  return search.every(
    (key) => currentUrl.searchParams.get(key) === nextUrl.searchParams.get(key)
  );
}

export const SHELL_MAX_AGE_MS = 5 * 60 * 1000;
