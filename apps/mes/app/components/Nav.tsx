import {
  Button,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import { Link, useLocation } from "@remix-run/react";
import type { IconType } from "react-icons";

interface NavProps {
  isCollapsed: boolean;
  links: {
    title: string;
    label?: string;
    icon: IconType;
    to: string;
  }[];
}

export function Nav({ links, isCollapsed }: NavProps) {
  const { pathname } = useLocation();
  return (
    <div
      data-collapsed={isCollapsed}
      className="group flex flex-col gap-4 py-2 data-[collapsed=true]:py-2"
    >
      <nav className="grid gap-1 px-2 group-[[data-collapsed=true]]:justify-center group-[[data-collapsed=true]]:px-2">
        {links.map((link, index) => {
          const isSelected = pathname.includes(link.to);
          return isCollapsed ? (
            <Tooltip key={index} delayDuration={0}>
              <TooltipTrigger asChild>
                <Link to={link.to}>
                  <IconButton
                    aria-label={link.title}
                    size="lg"
                    icon={<link.icon className="h-4 w-4" />}
                    variant={isSelected ? "primary" : "ghost"}
                  />
                </Link>
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
              className="w-full justify-between"
              size="lg"
              variant={isSelected ? "primary" : "ghost"}
              asChild
            >
              <Link to={link.to}>
                <HStack spacing={2}>
                  <link.icon className="mr-2 h-4 w-4" />
                  {link.title}
                </HStack>
                {link.label && <span className="ml-auto">{link.label}</span>}
              </Link>
            </Button>
          );
        })}
      </nav>
    </div>
  );
}
