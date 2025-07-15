import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  TooltipProvider,
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { Outlet, useFetcher, useRevalidator } from "@remix-run/react";
import { LuMoon, LuRefreshCw, LuSun } from "react-icons/lu";
import type { action } from "~/root";
export default function ExternalLayout() {
  const fetcher = useFetcher<typeof action>();
  const mode = useMode();
  const revalidator = useRevalidator();

  return (
    <TooltipProvider>
      <div className="w-screen min-h-screen flex flex-col items-center justify-center">
        <div className="absolute top-4 right-4">
          <HStack>
            <IconButton
              aria-label="Refresh"
              variant="ghost"
              size="sm"
              icon={<LuRefreshCw />}
              onClick={() => revalidator.revalidate()}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Toggle dark/light mode"
                  variant="ghost"
                  size="sm"
                  icon={mode === "dark" ? <LuMoon /> : <LuSun />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    fetcher.submit(
                      { mode: "light" },
                      { method: "post", action: "/" }
                    );
                  }}
                >
                  <LuSun className="mr-2 h-4 w-4" />
                  Light
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    fetcher.submit(
                      { mode: "dark" },
                      { method: "post", action: "/" }
                    );
                  }}
                >
                  <LuMoon className="mr-2 h-4 w-4" />
                  Dark
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </div>
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
