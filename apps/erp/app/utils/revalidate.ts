import type { ShouldRevalidateFunction } from "react-router";

/**
 * Skips revalidation for navigations that only open/close a child drawer or
 * page through it (`offset` param) — report loaders depend on the remaining
 * search params only, and their balance RPCs are expensive. Mutations and any
 * other param change revalidate as usual.
 */
export const revalidateIgnoringOffset: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate
}) => {
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate;

  const current = new URLSearchParams(currentUrl.search);
  const next = new URLSearchParams(nextUrl.search);
  current.delete("offset");
  next.delete("offset");
  current.sort();
  next.sort();

  if (current.toString() === next.toString()) return false;

  return defaultShouldRevalidate;
};

/**
 * True when a navigation only changed the search params of the page we are
 * already on — a table filter, sort, page, or drawer toggle.
 *
 * These are by far the most frequent navigations in the app, and none of them
 * can change app-shell data (no mutation ran and the route didn't change), so
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
