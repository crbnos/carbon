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
    <div className="inline-flex h-9 items-center justify-center rounded-[0.5rem] bg-muted p-1 text-muted-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]  border-b border-border">
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
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-[6px] px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive && "bg-background text-foreground shadow-button-base"
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
