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

// The pivot report display toggles that buildPivotTree applies in the browser —
// they never change the loader's (expensive) journal RPC inputs, so a change to
// only these can skip the refetch. The route component re-derives them from the
// URL via applyPivotDisplayParams so the view stays in sync without a loader run.
const PIVOT_DISPLAY_PARAMS = ["measure", "pct", "sort"];

/**
 * Skips revalidation for the analytics pivot reports when a navigation changes
 * ONLY the client-only display params (`measure` / `pct` / `sort`). Any
 * server-affecting param change, a different report, a mutation, and an
 * unchanged URL (realtime journal revalidation, initial load) all revalidate as
 * usual — so live updates and saved-view/filter/date changes still refetch.
 */
export const revalidateIgnoringPivotDisplay: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate
}) => {
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  // Unchanged URL → an explicit revalidation (e.g. realtime) or initial load.
  if (currentUrl.search === nextUrl.search) return defaultShouldRevalidate;

  const current = new URLSearchParams(currentUrl.search);
  const next = new URLSearchParams(nextUrl.search);
  for (const key of PIVOT_DISPLAY_PARAMS) {
    current.delete(key);
    next.delete(key);
  }
  current.sort();
  next.sort();

  // Only display params differ → same loader data; skip. Otherwise refetch.
  if (current.toString() === next.toString()) return false;

  return defaultShouldRevalidate;
};
