import { HStack } from "@carbon/react";
import { Agent } from "~/components/Agent/Agent";
import { usePermissions, useUser } from "~/hooks";
import { useFlags } from "~/hooks/useFlags";
import AvatarMenu from "../../AvatarMenu";
import Breadcrumbs from "./Breadcrumbs";
import CreateMenu from "./CreateMenu";
import Feedback from "./Feedback";
import Notifications from "./Notifications";
import Search from "./Search";

const Topbar = () => {
  const permissions = usePermissions();
  const user = useUser();
  const notificationsKey = `${user.id}:${user.company.id}`;

  const { isInternal } = useFlags();

  return (
    <div className="h-[49px] grid grid-cols-[1fr_200px_1fr] bg-background text-foreground px-4 top-0 sticky z-10 items-center">
      <div className="flex-1">
        <Breadcrumbs />
      </div>
      <div className="flex justify-center">
        {permissions.is("employee") ? <Search /> : <div />}
      </div>
      <HStack spacing={1} className="flex-1 justify-end py-2">
        <Feedback />
        <CreateMenu />
        {isInternal && <Agent />}
        <Notifications key={notificationsKey} />
        <AvatarMenu />
      </HStack>
    </div>
  );
};

export default Topbar;
