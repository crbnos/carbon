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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  useMode,
  useModePreference
} from "@carbon/react";
import { modeValidator } from "@carbon/utils";
import { useState } from "react";
import {
  LuHouse,
  LuLaptop,
  LuLogOut,
  LuMoon,
  LuSun,
  LuUser
} from "react-icons/lu";
import { Form, Link, useFetcher } from "react-router";
import { Avatar } from "~/components";
import { useUser } from "~/hooks";
import type { action } from "~/root";
import { path } from "~/utils/path";

const AvatarMenu = () => {
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;

  const mode = useMode();
  const modePreference = useModePreference();

  const fetcher = useFetcher<typeof action>();
  const [isOpen, setIsOpen] = useState(false);
  const openAccountSettings = useAccountSettings((s) => s.open);

  const onModeChange = (value: string) => {
    const parsed = modeValidator.shape.mode.safeParse(value);
    if (!parsed.success || parsed.data === modePreference) return;
    document.body.removeAttribute("style");
    const formData = new FormData();
    formData.append("mode", parsed.data);
    fetcher.submit(formData, { method: "post", action: path.to.root });
  };

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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <DropdownMenuIcon icon={mode === "dark" ? <LuMoon /> : <LuSun />} />
            Appearance
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={modePreference}
              onValueChange={onModeChange}
            >
              <DropdownMenuRadioItem
                value="light"
                onSelect={(e) => e.preventDefault()}
              >
                <DropdownMenuIcon icon={<LuSun />} />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="dark"
                onSelect={(e) => e.preventDefault()}
              >
                <DropdownMenuIcon icon={<LuMoon />} />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="system"
                onSelect={(e) => e.preventDefault()}
              >
                <DropdownMenuIcon icon={<LuLaptop />} />
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
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
