// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn, PrefetchLink, VStack } from "@carbon/react";
import { useUrlParams } from "~/hooks";
import type { Route } from "~/types";
import { SidebarLinks, useSidebarLocation } from "./CollapsibleSidebar";

const ContentSidebar = ({ links }: { links: Route[] }) => {
  const location = useSidebarLocation((pathname) =>
    links.some((route) => pathname.includes(route.to))
  );
  const [params] = useUrlParams();
  const filter = params.get("q") ?? undefined;

  return (
    <SidebarLinks>
      <VStack>
        <VStack spacing={1} className="p-2">
          {links.map((route) => {
            const isActive =
              location.pathname.includes(route.to) && route.q === filter;
            return (
              <Button
                key={route.name}
                asChild
                leftIcon={route.icon}
                variant={isActive ? "active" : "ghost"}
                data-nav-item=""
                className={cn(
                  "w-full justify-start",
                  !isActive &&
                    "hover:bg-transparent hover:text-active-foreground"
                )}
              >
                <PrefetchLink to={route.to + (route.q ? `?q=${route.q}` : "")}>
                  {route.name}
                </PrefetchLink>
              </Button>
            );
          })}
        </VStack>
      </VStack>
    </SidebarLinks>
  );
};

export default ContentSidebar;
