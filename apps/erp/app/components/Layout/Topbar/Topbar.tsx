// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack, IconButton, useViewport } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuSquarePen } from "react-icons/lu";
import { useUser } from "~/hooks";
import AvatarMenu from "../../AvatarMenu";
import AskDocs from "./AskDocs";
import Breadcrumbs from "./Breadcrumbs";
import CreateMenu, { useCreateShortcuts } from "./CreateMenu";
import Notifications from "./Notifications";
import Suggestion from "./Suggestion";

const Topbar = () => {
  const { t } = useLingui();
  const user = useUser();
  const notificationsKey = `${user.id}:${user.company.id}`;
  useCreateShortcuts();
  // Phones get the MobileAppBar and MobileDock instead; returning early
  // also keeps the notifications subscription and menus from mounting there.
  const { isPhone } = useViewport();
  if (isPhone) return null;

  return (
    <div className="h-[var(--topbar-height)] grid grid-cols-[1fr_auto] bg-card border-b border-border text-foreground px-4 top-0 sticky z-10 items-center">
      <div className="flex-1 hidden md:block">
        <Breadcrumbs />
      </div>
      <HStack spacing={1} className="flex-1 justify-end py-2">
        <div className="hidden sm:block">
          <AskDocs />
        </div>
        <div className="hidden sm:block">
          <Suggestion />
        </div>
        <CreateMenu
          trigger={
            <IconButton
              aria-label={t`Create`}
              icon={<LuSquarePen />}
              variant="ghost"
            />
          }
        />

        <Notifications key={notificationsKey} />

        <AvatarMenu />
      </HStack>
    </div>
  );
};

export default Topbar;
