import { HStack } from "@carbon/react";
import { Search } from "~/components/Search";
import { usePermissions } from "~/hooks";
import AvatarMenu from "./AvatarMenu";
import Breadcrumbs from "./Breadcrumbs";
import HelpMenu from "./HelpMenu";
import ModeSwitcher from "./ModeSwitcher";

const Topbar = () => {
  const permissions = usePermissions();
  return (
    <div className="grid bg-background text-foreground border-b border-border px-4 top-0 sticky z-10 space-x-4 grid-cols-[auto_1fr] sm:grid-cols-[1fr_auto_1fr] items-center">
      <Breadcrumbs />
      {permissions.is("employee") ? <Search /> : <div />}
      <HStack spacing={1} className="justify-end py-2">
        {/* <CreateMenu /> */}
        <HelpMenu />
        <ModeSwitcher />
        <AvatarMenu />
      </HStack>
    </div>
  );
};

export default Topbar;
