import { HStack } from "@carbon/react";

import AvatarMenu from "./AvatarMenu";
import Breadcrumbs from "./Breadcrumbs";

const Topbar = () => {
  return (
    <div className="flex bg-background text-foreground pl-4 pr-2 top-0 sticky z-10 gap-x-4 justify-between items-center">
      <Breadcrumbs />

      <HStack spacing={2} className="justify-end py-2">
        <AvatarMenu />
      </HStack>
    </div>
  );
};

export default Topbar;
