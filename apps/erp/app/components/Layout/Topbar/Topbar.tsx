import { HStack } from "@carbon/react";
import { usePermissions, useUser } from "~/hooks";
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

  return (
    <div className="flex bg-background text-foreground border-b border-border px-4 top-0 sticky z-10 items-center">
      <div className="flex-1">
        <Breadcrumbs />
      </div>
      <div className="flex-1 flex justify-center">
        {permissions.is("employee") ? <Search /> : <div />}
      </div>
      <HStack spacing={2} className="flex-1 justify-end py-2">
        <Feedback />
        <CreateMenu />
        <Notifications key={notificationsKey} />
        <AvatarMenu />
      </HStack>
    </div>
  );
};

export default Topbar;
