// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LuHouse, LuLayoutGrid, LuSearch, LuSquarePen } from "react-icons/lu";
import { Link, useLocation } from "react-router";
import { Avatar } from "~/components";
import { useUser } from "~/hooks";
import { useUIStore } from "~/stores/ui";
import { path } from "~/utils/path";
import { useBottomBarActive } from "./ChromeSlots";
import { CreateSheet } from "./CreateSheet";
import { ModulesSheet } from "./ModulesSheet";
import { ProfileSheet } from "./ProfileSheet";
import { useAppBar } from "./useAppBar";

const tabClassName =
  "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium leading-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Tab({
  icon,
  label,
  isActive
}: {
  icon: ReactNode;
  label: string;
  isActive?: boolean;
}) {
  return (
    <>
      <span
        className={cn(
          "flex size-6 items-center justify-center [&>svg]:size-5",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "max-w-full truncate",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </>
  );
}

/**
 * The compact tab bar: Home, Search, Create, Modules, Profile — each
 * an existing desktop control. Shown on root screens only; a page's bottom
 * bar (action or bulk bar) replaces it. Hidden at md and above.
 */
export function MobileTabBar() {
  const { t } = useLingui();
  const { kind } = useAppBar();
  const bottomBarActive = useBottomBarActive();
  const { pathname } = useLocation();
  const user = useUser();
  const openSearchModal = useUIStore((s) => s.openSearchModal);
  const [sheet, setSheet] = useState<"create" | "modules" | "profile" | null>(
    null
  );
  const setOpen = (name: typeof sheet) => (open: boolean) =>
    setSheet(open ? name : null);

  // Any navigation closes the open sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on navigation only
  useEffect(() => {
    setSheet(null);
  }, [pathname]);

  const hidden = kind === "pushed" || bottomBarActive;
  const isHome = pathname === path.to.authenticatedRoot;

  return (
    <>
      <nav
        aria-label={t`Main`}
        className={cn(
          "md:hidden flex shrink-0 items-stretch border-t border-border bg-card/92 px-1 pt-1 pb-safe backdrop-blur",
          hidden && "hidden"
        )}
      >
        <Link
          to={path.to.authenticatedRoot}
          className={tabClassName}
          aria-current={isHome ? "page" : undefined}
        >
          <Tab icon={<LuHouse />} label={t`Home`} isActive={isHome} />
        </Link>
        <button
          type="button"
          className={tabClassName}
          onClick={openSearchModal}
        >
          <Tab icon={<LuSearch />} label={t`Search`} />
        </button>
        <button
          type="button"
          className={tabClassName}
          onClick={() => setSheet("create")}
        >
          <Tab
            icon={<LuSquarePen />}
            label={t`Create`}
            isActive={sheet === "create"}
          />
        </button>
        <button
          type="button"
          className={tabClassName}
          onClick={() => setSheet("modules")}
        >
          <Tab
            icon={<LuLayoutGrid />}
            label={t`Modules`}
            isActive={sheet === "modules"}
          />
        </button>
        <button
          type="button"
          className={tabClassName}
          onClick={() => setSheet("profile")}
        >
          <Tab
            icon={
              <Avatar
                path={user.avatarUrl}
                name={`${user.firstName} ${user.lastName}`}
                size="xs"
              />
            }
            label={t`Profile`}
            isActive={sheet === "profile"}
          />
        </button>
      </nav>
      <CreateSheet open={sheet === "create"} onOpenChange={setOpen("create")} />
      <ModulesSheet
        open={sheet === "modules"}
        onOpenChange={setOpen("modules")}
      />
      <ProfileSheet
        open={sheet === "profile"}
        onOpenChange={setOpen("profile")}
      />
    </>
  );
}
