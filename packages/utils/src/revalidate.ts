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

/** Every app's root action: it only writes appearance cookies. */
export const ROOT_ACTION = "/";

/**
 * How an appearance choice is saved. Only the root loader reads the cookies,
 * so the save asks no other route to re-run; the root opts back in
 * (`rootShouldRevalidate`) and a route with its own `shouldRevalidate` wraps
 * it in `deferRootActionPost`.
 */
export const ROOT_ACTION_SAVE = {
  method: "post",
  action: ROOT_ACTION,
  defaultShouldRevalidate: false
} as const;

type RevalidateArgs = {
  formAction?: string;
  formMethod?: string;
  defaultShouldRevalidate: boolean;
};

export function isRootActionPost({
  formAction,
  formMethod
}: {
  formAction?: string;
  formMethod?: string;
}) {
  return formAction === ROOT_ACTION && !!formMethod && formMethod !== "GET";
}

/**
 * The ERP and MES root: re-run for an appearance save, skip a same-page
 * search-param change, else follow the default.
 */
export function rootShouldRevalidate(
  args: RevalidateArgs & { currentUrl: URL; nextUrl: URL }
) {
  if (isRootActionPost(args)) return true;
  return isSearchParamOnlyNavigation(args)
    ? false
    : args.defaultShouldRevalidate;
}

/**
 * A route `shouldRevalidate` that would otherwise re-run after any post,
 * left to the default for an appearance save.
 */
export function deferRootActionPost<Args extends RevalidateArgs>(
  shouldRevalidate: (args: Args) => boolean
) {
  return (args: Args) =>
    isRootActionPost(args)
      ? args.defaultShouldRevalidate
      : shouldRevalidate(args);
}

export const SHELL_MAX_AGE_MS = 5 * 60 * 1000;
