// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCircleHelp, LuFiles } from "react-icons/lu";
import { path } from "~/utils/path";

const HelpMenu = () => {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          className="hidden sm:flex"
          aria-label={t`Help`}
          icon={<LuCircleHelp />}
          variant="ghost"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <a href={path.to.apiDocs} target="_blank" rel="noreferrer">
            <DropdownMenuIcon icon={<LuFiles />} />
            <Trans>API Docs</Trans>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default HelpMenu;
