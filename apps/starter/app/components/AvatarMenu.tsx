// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAccountSettings } from "@carbon/account";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useMode
} from "@carbon/react";
import { useState } from "react";
import { LuHouse, LuLogOut, LuMoon, LuSun, LuUser } from "react-icons/lu";
import { Form, Link } from "react-router";
import { Avatar } from "~/components";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";

const AvatarMenu = () => {
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;

  const mode = useMode();
  const [isOpen, setIsOpen] = useState(false);
  const openAccountSettings = useAccountSettings((s) => s.open);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger className="outline-none focus-visible:outline-none">
        <Avatar path={user.avatarUrl} name={name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Signed in as {name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={path.to.dashboard}>
            <DropdownMenuIcon icon={<LuHouse />} />
            Dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openAccountSettings()}>
          <DropdownMenuIcon icon={<LuUser />} />
          Account Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openAccountSettings("appearance")}>
          <DropdownMenuIcon icon={mode === "dark" ? <LuMoon /> : <LuSun />} />
          Appearance
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
          <Form method="post" action={path.to.logout}>
            <button type="submit" className="w-full flex items-center">
              <DropdownMenuIcon icon={<LuLogOut />} />
              <span>Sign Out</span>
            </button>
          </Form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AvatarMenu;
