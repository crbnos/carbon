import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@carbon/react";
import { Outlet, useFetcher } from "@remix-run/react";
import { LuMoon, LuSun } from "react-icons/lu";
import { useMode } from "~/hooks/useMode";
import type { action } from "~/root";
export default function ExternalLayout() {
  const fetcher = useFetcher<typeof action>();
  const mode = useMode();

  return (
    <div className="w-screen min-h-screen flex flex-col items-center justify-center">
      <div className="absolute top-4 right-4">
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
      </div>
      <Outlet />
    </div>
  );
}
