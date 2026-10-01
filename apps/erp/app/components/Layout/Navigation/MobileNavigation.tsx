// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
