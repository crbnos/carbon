import type { Company } from "@carbon/auth";
import {
  Button,
  cn,
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
  HStack,
  Switch,
} from "@carbon/react";
import { Form, Link, useFetcher } from "@remix-run/react";
import { useRef, useState } from "react";
import {
  LuBuilding,
  LuChevronsUpDown,
  LuLogOut,
  LuMapPin,
  LuMoon,
  LuSun,
  LuUser,
} from "react-icons/lu";
import { Avatar } from "~/components";
import { useUser } from "~/hooks";
import { useMode } from "~/hooks/useMode";
import type { action } from "~/routes/x+/location";
import type { Location } from "~/services/operations.service";
import { path } from "~/utils/path";

const AvatarMenu = ({
  isCollapsed,
  company,
  companies,
  location,
  locations,
}: {
  company: Company;
  companies: Company[];
  isCollapsed: boolean;
  location: string;
  locations: Location[];
}) => {
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;

  const mode = useMode();

  const nextMode = mode === "dark" ? "light" : "dark";
  const modeSubmitRef = useRef<HTMLButtonElement>(null);

  const fetcher = useFetcher<typeof action>();
  const [isOpen, setIsOpen] = useState(false);

  const updateLocation = (value: string) => {
    const formData = new FormData();
    formData.append("location", value);
    fetcher.submit(formData, { method: "POST", action: path.to.location });
  };

  const optimisticLocation =
    (fetcher.formData?.get("location") as string | undefined) ?? location;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger className={cn(!isCollapsed && "w-full")}>
        {isCollapsed ? (
          <Avatar size="sm" src={user?.avatarUrl ?? undefined} name={name} />
        ) : (
          <Button
            className="w-full justify-between"
            size="lg"
            variant="secondary"
          >
            <HStack spacing={2}>
              <Avatar
                size="xs"
                src={user?.avatarUrl ?? undefined}
                name={name}
              />
              <span>{name}</span>
            </HStack>
            <LuChevronsUpDown />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Signed in as {name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={path.to.accountSettings}>
            <DropdownMenuIcon icon={<LuUser />} />
            Account Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {companies && companies.length > 1 ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DropdownMenuIcon icon={<LuBuilding />} />
                Company
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={company.companyId!}>
                  {companies.map((c) => {
                    const logo =
                      mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
                    return (
                      <DropdownMenuRadioItem
                        key={c.companyId}
                        value={c.companyId!}
                        onSelect={() => {
                          const form = new FormData();
                          form.append("companyId", c.companyId!);
                          fetcher.submit(form, {
                            method: "post",
                            action: path.to.switchCompany(c.companyId!),
                          });
                        }}
                      >
                        <HStack>
                          <Avatar
                            size="xs"
                            name={c.name ?? undefined}
                            src={logo ?? undefined}
                          />
                          <span>{c.name}</span>
                        </HStack>
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {locations.length > 1 ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DropdownMenuIcon icon={<LuMapPin />} />
                Location
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={optimisticLocation}>
                  {locations.map((loc) => (
                    <DropdownMenuRadioItem
                      key={loc.id}
                      value={loc.id}
                      onSelect={() => {
                        updateLocation(loc.id);
                      }}
                    >
                      {loc.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        ) : null}
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
