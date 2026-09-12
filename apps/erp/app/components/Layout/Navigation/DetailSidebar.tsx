import type { ShortcutInput } from "@carbon/react";
import {
  Button,
  Count,
  HStack,
  ShortcutKey,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutKeyMap,
  VStack
} from "@carbon/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { useOptimisticLocation } from "~/hooks";

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
                <Link
                  to={route.to}
                  prefetch="intent"
                  className="flex items-center justify-start gap-2"
                >
                  {route.icon}
                  <span>{route.name}</span>
                  {route.count !== undefined && (
                    <Count count={route.count} className="ml-auto" />
                  )}
                </Link>
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
