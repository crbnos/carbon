import { HStack } from "@carbon/react";
import { usePermissions } from "~/hooks";
import AvatarMenu from "./AvatarMenu";
import Breadcrumbs from "./Breadcrumbs";
import CreateMenu from "./CreateMenu";
import HelpMenu from "./HelpMenu";
import ModeSwitcher from "./ModeSwitcher";
import Search from "./Search";

const Topbar = () => {
  const permissions = usePermissions();
  return (
    <div className="flex bg-background text-foreground border-b border-border px-4 top-0 sticky z-10 space-x-4 justify-between items-center">
      <Breadcrumbs />

      <HStack spacing={2} className="justify-end py-2">
        {permissions.is("employee") ? <Search /> : <div />}
        <CreateMenu />
        <HelpMenu />
        <ModeSwitcher />
        <AvatarMenu />
      </HStack>
    </div>
  );
};

export default Topbar;
