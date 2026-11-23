// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useSearchParams } from "react-router";
import {
  queueKeyForPath,
  queuePath,
  useQueueTitles
} from "~/components/AppSidebar";
import { path } from "~/utils/path";

/** The query parameter that carries the page an operation was opened from. */
export const ORIGIN_PARAM = "from";

/**
 * `to` plus `?from=<the current page>`, so Back can return to that page.
 * Without an origin it is `to` unchanged.
 */
export function withOrigin(
  to: string,
  from: string | { pathname: string; search: string } | null
): string {
  if (from === null) return to;
  const separator = to.includes("?") ? "&" : "?";
  const value = encodeURIComponent(
    typeof from === "string" ? from : `${from.pathname}${from.search}`
  );
  return `${to}${separator}${ORIGIN_PARAM}=${value}`;
}

/**
 * The origin page, or null. Only MES paths (`/x/…`) count. Reads the URL's
 * search params, or a form that posts the origin as a hidden `from` field.
 */
export function readOrigin(
  params: Pick<URLSearchParams, "get"> | Pick<FormData, "get">
): string | null {
  const from = params.get(ORIGIN_PARAM);
  return typeof from === "string" && from.startsWith("/x/") ? from : null;
}

/** A form's hidden `from` field, so the action's redirect keeps the origin. */
export function OriginInput() {
  const [searchParams] = useSearchParams();
  const origin = readOrigin(searchParams);
  return origin ? (
    <input type="hidden" name={ORIGIN_PARAM} value={origin} />
  ) : null;
}

/** Back on Operation, Assembly and Inspection: the `from` page, else Schedule. */
export function useOrigin(): { to: string; label: string } {
  const { t } = useLingui();
  const [searchParams] = useSearchParams();
  const titles = useQueueTitles();
  const from = readOrigin(searchParams);
  if (!from) return { to: path.to.operations, label: titles.operations };
  // Back from a job graph returns to that job, not to the Jobs list.
  if (queuePath(from).startsWith(`${path.to.jobDag("")}/`)) {
    return { to: from, label: t`Job` };
  }
  const key = queueKeyForPath(queuePath(from));
  return { to: from, label: key ? titles[key] : titles.operations };
}
