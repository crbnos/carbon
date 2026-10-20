// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuHouse } from "react-icons/lu";
import { useMatches } from "react-router";
import { z } from "zod";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  Breadcrumbs as BreadcrumbsBase
} from "~/components";
import type { BreadcrumbSegment } from "~/utils/handle";
import { path } from "~/utils/path";

export const BreadcrumbHandle = z.object({
  breadcrumb: z.any(),
  to: z.string().optional()
});
export type BreadcrumbHandleType = z.infer<typeof BreadcrumbHandle>;

const BreadcrumbHandleMatch = z.object({
  handle: BreadcrumbHandle
});

/**
 * The current route's breadcrumbs from each match's `handle.breadcrumb`, with
 * `msg` descriptors translated. Desktop renders them as Breadcrumbs; the
 * compact app bar derives its title, subtitle and Back target from them.
 */
export function useBreadcrumbs() {
  const { i18n } = useLingui();
  const matches = useMatches();

  // Only a `msg` descriptor is translatable; a plain string is data (an entity's
  // readable id) and is shown as-is.
  const translateBreadcrumb = (value: unknown): ReactNode => {
    if (typeof value === "object" && value !== null && "id" in value) {
      return i18n._(value as { id: string; message?: string });
    }
    return value as ReactNode;
  };

  const breadcrumbs = matches.flatMap((m) => {
    const result = BreadcrumbHandleMatch.safeParse(m);
    if (!result.success || !result.data.handle.breadcrumb) return [];

    const handle = result.data.handle;
    const resolved =
      typeof handle.breadcrumb === "function"
        ? handle.breadcrumb(m.params, m.data)
        : handle.breadcrumb;

    // A detail route may resolve to multiple segments (list link + entity id);
    // a plain handle resolves to one, defaulting its link to the match's path.
    const segments: BreadcrumbSegment[] = Array.isArray(resolved)
      ? resolved.filter((seg) => seg && seg.breadcrumb)
      : resolved
        ? [{ breadcrumb: resolved, to: handle.to ?? m.pathname }]
        : [];

    return segments.map((seg) => ({
      breadcrumb: translateBreadcrumb(seg.breadcrumb),
      to: seg.to // undefined => rendered as current page (no link)
    }));
  });

  return breadcrumbs;
}

const Breadcrumbs = () => {
  const { t } = useLingui();
  const breadcrumbs = useBreadcrumbs();

  return (
    <HStack className="items-center h-full hidden md:flex -ml-2" spacing={0}>
      <BreadcrumbsBase className="line-clamp-1">
        {/* Always first. On the dashboard itself it is the current page. */}
        <BreadcrumbItem>
          <BreadcrumbLink
            isCurrentPage={breadcrumbs.length === 0}
            to={path.to.authenticatedRoot}
            aria-label={t`Home`}
          >
            <LuHouse className="size-4" />
          </BreadcrumbLink>
        </BreadcrumbItem>
        {breadcrumbs.map((breadcrumb, i) => (
          <BreadcrumbItem key={i}>
            <BreadcrumbLink
              isCurrentPage={!breadcrumb?.to}
              to={breadcrumb?.to ?? ""}
            >
              {breadcrumb?.breadcrumb}
            </BreadcrumbLink>
          </BreadcrumbItem>
        ))}
      </BreadcrumbsBase>
    </HStack>
  );
};

export default Breadcrumbs;
