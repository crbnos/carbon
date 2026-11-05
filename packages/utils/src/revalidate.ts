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
 * True for a post to the root action (`/`). It only writes appearance cookies,
 * which only the root loader reads: the root opts in to re-run, and a shell
 * skips it.
 */
export function isRootActionPost({
  formAction,
  formMethod
}: {
  formAction?: string;
  formMethod?: string;
}) {
  return formAction === "/" && !!formMethod && formMethod !== "GET";
}

export const SHELL_MAX_AGE_MS = 5 * 60 * 1000;
