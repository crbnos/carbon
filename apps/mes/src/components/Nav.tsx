import type { IconType } from "react-icons";

import {
  Button,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@carbon/react";
import { Link } from "react-router-dom";

interface NavProps {
  isCollapsed: boolean;
  links: {
    title: string;
    label?: string;
    icon: IconType;
    variant: "primary" | "ghost";
  }[];
}

export function Nav({ links, isCollapsed }: NavProps) {
  return (
    <div
      data-collapsed={isCollapsed}
      className="group flex flex-col gap-4 py-2 data-[collapsed=true]:py-2 justify-between h-full"
    >
      <nav className="grid gap-1 px-2 group-[[data-collapsed=true]]:justify-center group-[[data-collapsed=true]]:px-2">
        {links.map((link, index) =>
          isCollapsed ? (
            <Tooltip key={index} delayDuration={0}>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label={link.title}
                  icon={<link.icon className="h-4 w-4" />}
                  variant={link.variant}
                />
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-4">
                {link.title}
                {link.label && (
                  <span className="ml-auto text-muted-foreground">
                    {link.label}
                  </span>
                )}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              key={index}
              leftIcon={<link.icon />}
              variant={link.variant}
              className={cn(
                link.variant === "primary" &&
                  "dark:bg-muted dark:text-white dark:hover:bg-muted dark:hover:text-white",
                "justify-start"
              )}
              asChild
            >
              <Link to="#">
                {link.title}
                {link.label && (
                  <span
                    className={cn(
                      "ml-auto",
                      link.variant === "primary" &&
                        "text-background dark:text-white"
                    )}
                  >
                    {link.label}
                  </span>
                )}
              </Link>
            </Button>
          )
        )}
      </nav>
    </div>
  );
}
