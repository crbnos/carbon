import { Button, cn, VStack } from "@carbon/react";
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
      <div className="overflow-y-auto h-full w-full pb-8">
        <VStack>
          {groups.map((group) => (
            <VStack
              key={group.name}
              className="border-b border-border p-2 pb-6"
              spacing={1}
            >
              <h4 className="text-xs text-foreground/70 font-medium pl-4 py-1">
                {group.name}
              </h4>
              {group.routes.map((route) => {
                const isActive = exactMatch
                  ? location.pathname === route.to
                  : location.pathname.includes(route.to);
                return (
                  <Button
                    key={route.name}
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
