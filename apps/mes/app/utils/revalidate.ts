/**
 * True when a navigation only changed the search params of the page we are
 * already on — a filter, sort, page, or drawer toggle.
 *
 * These are the most frequent navigations in the app, and none of them can
 * change app-shell data (no mutation ran and the route didn't change), so
 * shell-level loaders can skip revalidating for them.
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
