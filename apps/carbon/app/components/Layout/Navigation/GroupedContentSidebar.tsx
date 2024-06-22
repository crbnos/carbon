import { Button, VStack } from "@carbon/react";
import { Link } from "@remix-run/react";
import { useOptimisticLocation } from "~/hooks";
import type { RouteGroup } from "~/types";
import { CollapsibleSidebar } from "./CollapsibleSidebar";

const GroupedContentSidebar = ({ groups }: { groups: RouteGroup[] }) => {
  const location = useOptimisticLocation();

  return (
    <CollapsibleSidebar>
      <div className="overflow-y-auto h-full w-full pb-8">
        <VStack>
          {groups.map((group) => (
            <VStack
              key={group.name}
              spacing={1}
              className="border-b border-border p-2"
            >
              <h4 className="text-xs text-muted-foreground font-mono pl-4 py-1 uppercase">
                {group.name}
              </h4>
              {group.routes.map((route) => {
                const isActive = location.pathname.includes(route.to);
                return (
                  <Button
                    key={route.name}
                    asChild
                    leftIcon={route.icon}
                    variant={isActive ? "active" : "ghost"}
                    className="w-full justify-start"
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
