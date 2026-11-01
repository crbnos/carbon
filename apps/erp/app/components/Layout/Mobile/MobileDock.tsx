// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Dock, DockItem, DockSeparator } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuMenu, LuPlus, LuSearch } from "react-icons/lu";
import { useLocation } from "react-router";
import { useUser } from "~/hooks";
import { useAppBadge } from "~/hooks/useAppBadge";
import { useNotifications } from "~/hooks/useNotifications";
import { useRestoreBrowserNotifications } from "~/hooks/usePushSubscription";
import { useUIStore } from "~/stores/ui";
import CreateMenu, { useCreate } from "../Topbar/CreateMenu";
import { usePushPublicKey } from "../Topbar/Notifications";
import { useBottomBarActive } from "./ChromeSlots";
import { MobileMenu } from "./MobileMenu";
import { ProfileSheet } from "./ProfileSheet";

type Sheet = "menu" | "create" | "profile" | "notifications";

/**
 * The phone's navigation: a floating pill with Search, Create and the menu.
 * The menu holds everything the desktop rail and top bar do — company,
 * modules or the module's sections, the account and notifications. A page's
 * bottom bar (action or bulk bar) replaces the pill. Hidden at md and above.
 */
export function MobileDock() {
  const { t } = useLingui();
  const bottomBarActive = useBottomBarActive();
  const { pathname } = useLocation();
  const user = useUser();
  const openSearchModal = useUIStore((s) => s.openSearchModal);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const setOpen = (name: Sheet) => (open: boolean) =>
    setSheet(open ? name : null);

  // One subscription, shared by the menu's bell and the Profile sheet.
  const notifications = useNotifications({
    companyId: user.company.id,
    userId: user.id
  });
  // Always mounted on phones, like the desktop bell: restores a signed-back-in
  // user's browser notifications.
  useRestoreBrowserNotifications({
    publicKey: usePushPublicKey(),
    userId: user.id
  });
  useAppBadge({ userId: user.id });
  const unread = notifications.notifications.filter((n) => !n.read).length;
  const canCreate = useCreate().length > 0;

  // Any navigation closes the open sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on navigation only
  useEffect(() => {
    setSheet(null);
  }, [pathname]);

  return (
    <>
      <Dock aria-label={t`Main`} className={cn(bottomBarActive && "hidden")}>
        <DockItem
          icon={<LuSearch />}
          label={t`Search`}
          onClick={() => {
            setSheet(null);
            openSearchModal();
          }}
        />
        <DockSeparator />
        {canCreate ? (
          <CreateMenu
            open={sheet === "create"}
            onOpenChange={setOpen("create")}
            trigger={<DockItem icon={<LuPlus />} aria-label={t`Create`} />}
          />
        ) : null}
        <DockItem
          icon={<LuMenu />}
          aria-label={t`Open menu`}
          aria-haspopup="dialog"
          aria-expanded={sheet === "menu"}
          onClick={() => setSheet("menu")}
        />
      </Dock>
      <MobileMenu
        open={sheet === "menu"}
        onOpenChange={setOpen("menu")}
        unread={unread}
        onOpenProfile={() => setSheet("profile")}
        onOpenNotifications={() => setSheet("notifications")}
      />
      <ProfileSheet
        open={sheet === "profile" || sheet === "notifications"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        notifications={notifications}
        initialScreen={sheet === "notifications" ? "notifications" : "root"}
      />
    </>
  );
}
