import { HStack } from "@carbon/react";

import AvatarMenu from "./AvatarMenu";
import ModeSwitcher from "./ModeSwitcher";

const Topbar = () => {
  return (
    <div className="flex bg-background text-foreground border-b border-border px-4 top-0 sticky z-10 space-x-4 justify-between items-center">
      <span className="font-mono font-bold uppercase">Developers</span>

      <HStack spacing={2} className="justify-end py-2">
        <ModeSwitcher />
        <AvatarMenu />
      </HStack>
    </div>
  );
};

export default Topbar;
