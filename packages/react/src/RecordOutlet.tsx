// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useContext } from "react";
import type { OutletProps } from "react-router";
import {
  Outlet,
  UNSAFE_RouteContext,
  useMatches,
  useParams
} from "react-router";

/** The `$param` names in a flat-routes route id (`…/$orderId.$lineId.details`). */
export function routeParamNames(routeId: string): string[] {
  return [...routeId.matchAll(/\$(\w+)/g)].map((match) => match[1]!);
}

/**
 * `<Outlet>` for a route with a param in its path: the page in it remounts
 * when it is shown for a different record.
 *
 * React Router keeps a route's components mounted when only its params change
 * (part A to part B, one order line to the next). Everything seeded once from
 * the record then belongs to the previous one: a form's default values, an
 * editor's initial content, a `useState` copy. A notes editor showed record
 * A's notes on record B, and the first keystroke saved them there.
 *
 * The key is the params of the route rendered in the outlet, not of the routes
 * below it: a drawer that opens over the page adds a param and must not
 * remount the page behind it. The layout's own chrome (header, explorer,
 * properties) is outside the outlet and stays mounted.
 */
export function RecordOutlet(props: OutletProps) {
  return <Outlet key={useRecordOutletKey()} {...props} />;
}

/** The key `RecordOutlet` gives its page: the params of the route shown in it. */
export function useRecordOutletKey(): string | undefined {
  const params = useParams();
  // The matches down to the route that renders this outlet; the next one is
  // the route shown in it.
  const depth = useContext(UNSAFE_RouteContext).matches.length;
  const child = useMatches()[depth];
  return child
    ? routeParamNames(child.id)
        .map((name) => params[name])
        .join("/")
    : undefined;
}
