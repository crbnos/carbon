// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PropsWithChildren } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from "./Dropdown";
import { IconButton } from "./IconButton";
import { Menu } from "./Menu";

type ActionMenuProps = PropsWithChildren<{
  icon?: JSX.Element;
  disabled?: boolean;
}>;

const ActionMenu = ({ children, ...props }: ActionMenuProps) => {
  return (
    <Menu type="dropdown">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label="Action Menu"
            variant="secondary"
            icon={<BsThreeDotsVertical />}
            {...props}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </Menu>
  );
};

export { ActionMenu };
