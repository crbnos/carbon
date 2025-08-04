import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { Form, Link, useFetcher } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuHouse, LuLogOut, LuMoon, LuSun, LuUser } from "react-icons/lu";
import { Avatar } from "~/components";
import { useUser } from "~/hooks";
import type { action } from "~/root";
import { path } from "~/utils/path";

const AvatarMenu = ({ className }: { className?: string }) => {
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;

  const mode = useMode();

  const nextMode = mode === "dark" ? "light" : "dark";
  const modeSubmitRef = useRef<HTMLButtonElement>(null);

  const fetcher = useFetcher<typeof action>();
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
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center justify-start">
              <DropdownMenuIcon
                icon={mode === "dark" ? <LuMoon /> : <LuSun />}
              />
              Dark Mode
            </div>
            <div>
              <Switch
                checked={mode === "dark"}
                onCheckedChange={() => modeSubmitRef.current?.click()}
              />
              <fetcher.Form
                action={path.to.root}
                method="post"
                onSubmit={() => {
                  document.body.removeAttribute("style");
                }}
                className="sr-only"
              >
                <input type="hidden" name="mode" value={nextMode} />
                <button ref={modeSubmitRef} className="sr-only" type="submit" />
              </fetcher.Form>
            </div>
          </div>
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
