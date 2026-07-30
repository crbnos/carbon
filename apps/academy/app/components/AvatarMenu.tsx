import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@carbon/react";
import { useState } from "react";
import { LuHouse, LuLogOut, LuUser } from "react-icons/lu";
import { Form, Link } from "react-router";
import { Avatar } from "~/components";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";

const AvatarMenu = ({ className }: { className?: string }) => {
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;

  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        className={cn(
          "outline-none focus-visible:outline-none cursor-pointer",
          className
        )}
      >
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
        <DropdownMenuItem asChild>
          <Link to={path.to.accountSettings}>
            <DropdownMenuIcon icon={<LuUser />} />
            Account Settings
          </Link>
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
