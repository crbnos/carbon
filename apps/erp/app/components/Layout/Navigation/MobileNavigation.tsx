import { IconButton, useSidebar } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuMenu } from "react-icons/lu";

/** Below `md` the rail rendered by `PrimaryNavigation` is a drawer; this opens it. */
const MobileNavigation = () => {
  const { t } = useLingui();
  const { toggleSidebar } = useSidebar();

  return (
    <IconButton
      aria-label={t`Open navigation`}
      icon={<LuMenu />}
      variant="ghost"
      onClick={toggleSidebar}
    />
  );
};

export default MobileNavigation;
