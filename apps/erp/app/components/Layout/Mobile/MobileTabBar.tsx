// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, TabBar, TabBarItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuHouse, LuLayoutGrid, LuSearch, LuSquarePen } from "react-icons/lu";
import { useLocation } from "react-router";
import { Avatar } from "~/components";
import { useUser } from "~/hooks";
import { useUIStore } from "~/stores/ui";
import { path } from "~/utils/path";
import CreateMenu from "../Topbar/CreateMenu";
import { useBottomBarActive } from "./ChromeSlots";
import { ModulesSheet } from "./ModulesSheet";
import { ProfileSheet } from "./ProfileSheet";
import { useAppBar } from "./useAppBar";

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
      <TabBar aria-label={t`Main`} className={cn(hidden && "hidden")}>
        <TabBarItem
          to={path.to.authenticatedRoot}
          icon={<LuHouse />}
          label={t`Home`}
          isActive={isHome}
        />
        <TabBarItem
          icon={<LuSearch />}
          label={t`Search`}
          onClick={openSearchModal}
        />
        <CreateMenu
          open={sheet === "create"}
          onOpenChange={setOpen("create")}
          trigger={
            <TabBarItem
              icon={<LuSquarePen />}
              label={t`Create`}
              isActive={sheet === "create"}
            />
          }
        />
        <TabBarItem
          icon={<LuLayoutGrid />}
          label={t`Modules`}
          isActive={sheet === "modules"}
          onClick={() => setSheet("modules")}
        />
        <TabBarItem
          icon={
            <Avatar
              path={user.avatarUrl}
              name={`${user.firstName} ${user.lastName}`}
              size="xs"
            />
          }
          label={t`Profile`}
          isActive={sheet === "profile"}
          onClick={() => setSheet("profile")}
        />
      </TabBar>
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
