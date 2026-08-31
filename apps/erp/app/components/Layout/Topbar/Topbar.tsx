import { HStack, IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuPanelLeft, LuSquarePen } from "react-icons/lu";
import { useUser } from "~/hooks";
import { useUIStore } from "~/stores/ui";
import AvatarMenu from "../../AvatarMenu";
import MobileNavigation from "../Navigation/MobileNavigation";
import AskDocs from "./AskDocs";
import Breadcrumbs from "./Breadcrumbs";
import CompanySwitcher from "./CompanySwitcher";
import CreateMenu from "./CreateMenu";
import Notifications from "./Notifications";
import Suggestion from "./Suggestion";

const Topbar = () => {
  const { t } = useLingui();
  const user = useUser();
  const notificationsKey = `${user.id}:${user.company.id}`;
  const hasContentSidebar = useUIStore((s) => s.hasContentSidebar);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <div className="h-[var(--topbar-height)] grid grid-cols-[1fr_auto] bg-background text-foreground px-4 top-0 sticky z-10 items-center">
      <div className="flex-1 hidden md:block">
        <Breadcrumbs />
      </div>
      <div className="flex-1 md:hidden flex items-center gap-1 min-w-0">
        <MobileNavigation />
        {hasContentSidebar && (
          <IconButton
            aria-label={t`Sections`}
            icon={<LuPanelLeft />}
            variant="ghost"
            onClick={toggleSidebar}
          />
        )}
        <CompanySwitcher />
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
