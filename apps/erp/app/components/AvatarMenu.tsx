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
  Switch,
} from "@carbon/react";
import { useEdition, useMode } from "@carbon/remix";
import { Edition, themes } from "@carbon/utils";
import { Form, Link, useFetcher } from "@remix-run/react";
import { useRef, useState } from "react";
import {
  LuCreditCard,
  LuFileText,
  LuHouse,
  LuLogOut,
  LuMoon,
  LuPalette,
  LuShieldCheck,
  LuSun,
  LuUser,
} from "react-icons/lu";
import { Avatar } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import { useTheme } from "~/hooks/useTheme";
import type { action } from "~/root";
import { path } from "~/utils/path";

const AvatarMenu = () => {
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;
  const { isOwner } = usePermissions();
  const edition = useEdition();

  const mode = useMode();
  const theme = useTheme();

  const nextMode = mode === "dark" ? "light" : "dark";
  const modeSubmitRef = useRef<HTMLButtonElement>(null);

  const fetcher = useFetcher<typeof action>();
  const [isOpen, setIsOpen] = useState(false);

  const onThemeChange = (t: string) => {
    const newTheme = themes.find((theme) => theme.name === t);
    if (!newTheme) return;
    const variables =
      mode === "dark" ? newTheme.cssVars.dark : newTheme.cssVars.light;

    const formData = new FormData();
    formData.append("theme", t);
    fetcher.submit(formData, { method: "post", action: path.to.theme });

    Object.entries(variables).forEach(([key, value]) => {
      document.body.style.setProperty(`--${key}`, value);
    });
  };

  const optimisticTheme =
    (fetcher?.formData?.get("theme") as string | null) ?? theme;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger className="outline-none focus-visible:outline-none">
        <Avatar path={user.avatarUrl} name={name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Signed in as {name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={path.to.authenticatedRoot}>
            <DropdownMenuIcon icon={<LuHouse />} />
            Dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to={path.to.apiIntroduction}>
            <DropdownMenuIcon icon={<LuFileText />} />
            API Documentation
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <DropdownMenuIcon icon={<LuPalette />} />
            Theme Color
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={optimisticTheme}
              onValueChange={onThemeChange}
            >
              {themes.map((t) => (
                <DropdownMenuRadioItem
                  key={t.name}
                  value={t.name}
                  onSelect={(e) => e.preventDefault()}
                  style={
                    {
                      "--theme-primary": `hsl(${
                        t?.activeColor[mode === "dark" ? "dark" : "light"]
                      })`,
                    } as React.CSSProperties
                  }
                >
                  <div className="flex items-center">
                    <div className="w-4 h-4 rounded-full mr-2 bg-[--theme-primary]" />
                    {t.label}
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={path.to.profile}>
            <DropdownMenuIcon icon={<LuUser />} />
            Account Settings
          </Link>
        </DropdownMenuItem>

        {edition === Edition.Cloud && isOwner() && (
          <DropdownMenuItem asChild>
            <Link to={path.to.billing}>
              <DropdownMenuIcon icon={<LuCreditCard />} />
              <span>Manage Subscription</span>
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <DropdownMenuIcon icon={<LuFileText />} />
            Terms and Privacy
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem asChild>
              <a href={path.to.legal.termsAndConditions}>
                <DropdownMenuIcon icon={<LuFileText />} />
                Terms of Service
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={path.to.legal.privacyPolicy}>
                <DropdownMenuIcon icon={<LuShieldCheck />} />
                Privacy Policy
              </a>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Form method="post" action={path.to.logout}>
            <button type="submit" className="w-full h-full flex items-center">
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
