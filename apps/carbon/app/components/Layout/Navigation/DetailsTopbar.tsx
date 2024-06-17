import {
  Count,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  useKeyboardShortcuts,
} from "@carbon/react";
import { prettifyKeyboardShortcut } from "@carbon/utils";
import { Link, useNavigate } from "@remix-run/react";
import type { IconType } from "react-icons";
import { useOptimisticLocation } from "~/hooks";

type DetailTopbarProps = {
  links: {
    name: string;
    to: string;
    icon?: IconType;
    count?: number;
    shortcut?: string;
  }[];
};

const DetailTopbar = ({ links }: DetailTopbarProps) => {
  const navigate = useNavigate();
  const location = useOptimisticLocation();

  useKeyboardShortcuts(
    links.reduce<Record<string, () => void>>((acc, link) => {
      if (link.shortcut) {
        acc[link.shortcut] = () => navigate(link.to);
      }
      return acc;
    }, {})
  );

  return (
    <div className="inline-flex h-8 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
      {links.map((route) => {
        const isActive = location.pathname.includes(route.to);

        return (
          <Tooltip key={route.name}>
            <TooltipTrigger className="w-full">
              <Link
                to={route.to}
                prefetch="intent"
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive && "bg-background text-foreground shadow"
                )}
              >
                {route.icon && <route.icon className="mr-2" />}
                <span>{route.name}</span>
                {route.count !== undefined && (
                  <Count count={route.count} className="ml-auto" />
                )}
              </Link>
            </TooltipTrigger>
            {route.shortcut && (
              <TooltipContent side="bottom">
                <HStack>{prettifyKeyboardShortcut(route.shortcut)}</HStack>
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}
    </div>
  );
};

export default DetailTopbar;
