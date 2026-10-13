// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ShortcutInput } from "@carbon/react";
import {
  Count,
  cn,
  HStack,
  PrefetchLink,
  ShortcutKey,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutKeyMap,
  useViewport
} from "@carbon/react";
import { useMemo } from "react";
import type { IconType } from "react-icons";
import { useNavigate } from "react-router";
import { useOptimisticLocation, useUrlParams } from "~/hooks";
import type { CompactTabItem } from "../CompactTabRow";
import { CompactTabRow } from "../CompactTabRow";
import { recordFrameSlot, recordTabsSlot } from "../Panels";
import { useSlidingHoverCard } from "./useSlidingHoverCard";

type DetailTopbarProps = {
  links: {
    name: string;
    to: string;
    icon?: IconType;
    count?: number;
    shortcut?: ShortcutInput;
    isActive?: (pathname: string) => boolean;
  }[];

  preserveParams?: boolean;
};

const DetailTopbar = ({
  links,

  preserveParams = false
}: DetailTopbarProps) => {
  const navigate = useNavigate();
  const location = useOptimisticLocation();
  const [params] = useUrlParams();
  // The same travelling hover card as the sidebar: it slides between tabs
  // and sits under the active one, whose own background covers it.
  const { containerRef, cardRef, handlers } =
    useSlidingHoverCard<HTMLDivElement>();

  useShortcutKeyMap(
    useMemo(
      () =>
        links.flatMap((link) =>
          link.shortcut
            ? [
                {
                  shortcut: link.shortcut,
                  action: () => {
                    const url = preserveParams
                      ? `${link.to}?${params.toString()}`
                      : link.to;
                    navigate(url);
                  }
                }
              ]
            : []
        ),
      [links, navigate, params, preserveParams]
    )
  );

  // Phones: inside a record frame the links join its one tab row; elsewhere
  // they render here as a scrolling underline row.
  const { isPhone } = useViewport();
  const paramString = params.toString();
  // `links` is a new array on every render: keyed on what the tabs show.
  const itemsKey = links
    .map((link) => {
      const active = link.isActive
        ? link.isActive(location.pathname)
        : location.pathname.includes(link.to);
      return `${link.name}|${link.to}|${link.count}|${active}`;
    })
    .join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on itemsKey
  const items = useMemo<CompactTabItem[]>(
    () =>
      links.map((route) => ({
        id: route.to,
        label: route.name,
        to: preserveParams ? `${route.to}?${paramString}` : route.to,
        count: route.count,
        active: route.isActive
          ? route.isActive(location.pathname)
          : location.pathname.includes(route.to)
      })),
    [itemsKey, preserveParams, paramString]
  );
  recordTabsSlot.useProvide(isPhone ? items : null);
  const inRecordFrame = recordFrameSlot.useValue() !== null;

  if (isPhone) {
    return inRecordFrame ? null : (
      <CompactTabRow className="w-full min-w-0 shrink" items={items} />
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center justify-center rounded-[0.5rem] bg-muted p-0.5 text-muted-foreground border border-border"
      {...handlers}
    >
      <span
        ref={cardRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-[6px] bg-active opacity-0 transition-[transform,width,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
      />
      {links.map((route) => {
        const isActive = route.isActive
          ? route.isActive(location.pathname)
          : location.pathname.includes(route.to);

        const linkTo = preserveParams
          ? `${route.to}?${params.toString()}`
          : route.to;

        return (
          <Tooltip key={route.name}>
            <TooltipTrigger className="w-full">
              <PrefetchLink
                to={linkTo}
                data-nav-item=""
                className={cn(
                  "relative inline-flex items-center justify-center whitespace-nowrap rounded-[6px] border border-transparent px-3 py-1 text-sm font-medium transition-[background-color,color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
                  isActive
                    ? "bg-background text-foreground shadow-button-base"
                    : "hover:text-foreground"
                )}
              >
                {route.icon && <route.icon className="mr-2" />}
                <span>{route.name}</span>
                {route.count !== undefined && (
                  <Count count={route.count} className="ml-auto" />
                )}
              </PrefetchLink>
            </TooltipTrigger>
            {route.shortcut && (
              <TooltipContent side="bottom">
                <HStack>
                  <ShortcutKey shortcut={route.shortcut} variant="small" />
                </HStack>
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}
    </div>
  );
};

export default DetailTopbar;
