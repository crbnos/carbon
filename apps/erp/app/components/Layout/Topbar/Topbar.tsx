import { HStack, IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuSquarePen } from "react-icons/lu";
import { usePermissions, useUser } from "~/hooks";
import AvatarMenu from "../../AvatarMenu";
import AskDocs from "./AskDocs";
import Breadcrumbs from "./Breadcrumbs";
import CompanySwitcher from "./CompanySwitcher";
import CreateMenu from "./CreateMenu";
import Notifications from "./Notifications";
import Search from "./Search";
import Suggestion from "./Suggestion";

const Topbar = () => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const user = useUser();
  const notificationsKey = `${user.id}:${user.company.id}`;

  return (
    <div className="h-[49px] grid grid-cols-[1fr_200px_1fr] bg-background text-foreground px-4 top-0 sticky z-10 items-center">
      <div className="flex-1 hidden md:block">
        <Breadcrumbs />
      </div>
      <div className="flex-1 md:hidden">
        <CompanySwitcher />
      </div>
      <div className="flex justify-center">
        {permissions.is("employee") ? <Search /> : <div />}
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
