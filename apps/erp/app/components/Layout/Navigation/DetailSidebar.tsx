// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ShortcutInput } from "@carbon/react";
import {
  Button,
  Count,
  HStack,
  PrefetchLink,
  ShortcutKey,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutKeyMap,
  useViewport,
  VStack
} from "@carbon/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useOptimisticLocation } from "~/hooks";
import { CompactTabRow } from "../CompactTabRow";

type DetailSidebarProps = {
  links: {
    name: string;
    to: string;
    icon?: ReactNode;
    count?: number;
    shortcut?: ShortcutInput;
  }[];
};

const DetailSidebar = ({ links }: DetailSidebarProps) => {
  const navigate = useNavigate();
  const location = useOptimisticLocation();

  useShortcutKeyMap(
    useMemo(
      () =>
        links.flatMap((link) =>
          link.shortcut
            ? [{ shortcut: link.shortcut, action: () => navigate(link.to) }]
            : []
        ),
      [links, navigate]
    )
  );

  // Phones: the same links as a sticky, horizontally scrolling underline
  // tab row, as DetailsTopbar renders outside a record.
  const { isPhone } = useViewport();
  if (isPhone) {
    return (
      <CompactTabRow
        className="sticky top-0 z-10 mb-3 w-full px-0"
        items={links.map((route) => ({
          id: route.name,
          label: route.name,
          to: route.to,
          count: route.count,
          active: location.pathname.includes(route.to)
        }))}
      />
    );
  }

  return (
    <VStack
      className="overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent h-full"
      spacing={1}
    >
      {links.map((route) => {
        const isActive = location.pathname.includes(route.to);

        return (
          <Tooltip key={route.name}>
            <TooltipTrigger className="w-full">
              <Button
                asChild
                variant={isActive ? "active" : "ghost"}
                className="w-full justify-start"
              >
                <PrefetchLink
                  to={route.to}
                  className="flex items-center justify-start gap-2"
                >
                  {route.icon}
                  <span>{route.name}</span>
                  {route.count !== undefined && (
                    <Count count={route.count} className="ml-auto" />
                  )}
                </PrefetchLink>
              </Button>
            </TooltipTrigger>
            {route.shortcut && (
              <TooltipContent side="right">
                <HStack>
                  <ShortcutKey shortcut={route.shortcut} variant="small" />
                </HStack>
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}
    </VStack>
  );
};

export default DetailSidebar;
