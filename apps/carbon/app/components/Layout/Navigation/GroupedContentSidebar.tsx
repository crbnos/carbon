import {
  Button,
  cn,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  VStack,
} from "@carbon/react";
import { Link } from "@remix-run/react";
import { useOptimisticLocation } from "~/hooks";
import type { RouteGroup } from "~/types";
import { CollapsibleSidebar } from "./CollapsibleSidebar";

const GroupedContentSidebar = ({
  groups,
  width = 200,
  exactMatch = false,
}: {
  groups: RouteGroup[];
  width?: number;
  exactMatch?: boolean;
}) => {
  const location = useOptimisticLocation();

  return (
    <CollapsibleSidebar width={width}>
      <div className="overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent h-full w-full pb-8">
        <VStack>
          {groups.map((group) => (
            <VStack
              key={group.name}
              className="border-b border-border p-2 pb-4 space-y-0.5"
            >
              <h4 className="text-xxs text-foreground/70 uppercase font-light tracking-wide pl-4 py-1">
                {group.name}
              </h4>
              {group.routes.map((route) => {
                const isActive = exactMatch
                  ? location.pathname === route.to
                  : location.pathname.includes(route.to) &&
                    !route.groups?.some((subRoute) =>
                      `${location.pathname}${location.search}`.includes(
                        subRoute.to
                      )
                    );
                return (
                  <div className="w-full flex flex-col" key={route.name}>
                    <Button
                      asChild
                      leftIcon={route.icon}
                      variant={isActive ? "active" : "ghost"}
                      className={cn(
                        "w-full justify-start truncate",
                        !isActive &&
                          "hover:bg-active hover:text-active-foreground"
                      )}
                    >
                      <Link
                        to={route.to + (route.q ? `?q=${route.q}` : "")}
                        prefetch="intent"
                      >
                        {route.name}
                      </Link>
                    </Button>
                    {route.groups && (
                      <SidebarMenuSub>
                        {route.groups.map((subRoute) => (
                          <SidebarMenuSubItem key={subRoute.name}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={`${location.pathname}${location.search}`.includes(
                                subRoute.to
                              )}
                            >
                              <Link to={subRoute.to}>{subRoute.name}</Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </div>
                );
              })}
            </VStack>
          ))}
        </VStack>
      </div>
    </CollapsibleSidebar>
  );
};

export default GroupedContentSidebar;
