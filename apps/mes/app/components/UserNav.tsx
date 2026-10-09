// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Company } from "@carbon/auth";
import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import {
  Avatar,
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
  ItarDisclosure,
  NavRailItem,
  Switch,
  useDisclosure,
  useMode,
  useModePreference,
  useRouteData,
  useSidebar
} from "@carbon/react";
import { modeValidator } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import {
  LuBuilding,
  LuChevronDown,
  LuLaptop,
  LuLogOut,
  LuMapPin,
  LuMonitor,
  LuMoon,
  LuShieldCheck,
  LuSun,
  LuUser,
  LuUsers
} from "react-icons/lu";
import { Form, Link, useFetcher } from "react-router";
import { useUser } from "~/hooks";
import type { action } from "~/root";
import type { Location } from "~/services/types";
import type { PinnedInUser } from "~/types";
import { path } from "~/utils/path";

type UserNavProps = {
  company: Company;
  companies: Company[];
  consoleEnabled?: boolean;
  consoleMode: boolean;
  location: string;
  locations: Location[];
  pinnedInUser: PinnedInUser | null;
};

/** The user menu's state and actions, shared by the rail menu and the phone More sheet. */
export function useUserNav({
  consoleMode,
  location,
  pinnedInUser
}: Pick<UserNavProps, "consoleMode" | "location" | "pinnedInUser">) {
  const user = useUser();
  const stationName = `${user.firstName} ${user.lastName}`;

  const mode = useMode();
  const modePreference = useModePreference();

  const fetcher = useFetcher<typeof action>();

  const onModeChange = (value: string) => {
    const parsed = modeValidator.shape.mode.safeParse(value);
    if (!parsed.success || parsed.data === modePreference) return;
    document.body.removeAttribute("style");
    const formData = new FormData();
    formData.append("mode", parsed.data);
    fetcher.submit(formData, { method: "post", action: path.to.root });
  };

  const updateLocation = (value: string) => {
    const formData = new FormData();
    formData.append("location", value);
    fetcher.submit(formData, { method: "POST", action: path.to.location });
  };

  const switchCompany = (companyId: string) => {
    const form = new FormData();
    form.append("companyId", companyId);
    fetcher.submit(form, {
      method: "post",
      action: path.to.switchCompany(companyId)
    });
  };

  const switchOperator = () => {
    fetcher.submit(null, { method: "POST", action: path.to.consolePinOut });
  };

  const toggleConsoleMode = () => {
    const formData = new FormData();
    formData.append("consoleMode", consoleMode ? "false" : "true");
    fetcher.submit(formData, { method: "post", action: path.to.consoleToggle });
  };

  const optimisticLocation =
    (fetcher.formData?.get("location") as string | undefined) ?? location;

  const itarDisclosure = useDisclosure();

  // useUser().id returns the effective (operator) ID — read the original station user ID directly
  const routeData = useRouteData<{ user: { id: string } | null }>(
    path.to.authenticatedRoot
  );
  const sessionUserId = routeData?.user?.id;
  const isOperatorPinnedIn = Boolean(
    consoleMode &&
      pinnedInUser &&
      sessionUserId &&
      pinnedInUser.userId !== sessionUserId
  );
  const showingOperator = consoleMode && pinnedInUser ? pinnedInUser : null;
  const displayName = showingOperator ? showingOperator.name : stationName;
  const displayAvatar = showingOperator
    ? showingOperator.avatarUrl
    : user.avatarUrl;

  return {
    stationName,
    mode,
    modePreference,
    onModeChange,
    updateLocation,
    switchCompany,
    switchOperator,
    toggleConsoleMode,
    optimisticLocation,
    itarDisclosure,
    isOperatorPinnedIn,
    showingOperator,
    displayName,
    displayAvatar
  };
}

export function UserNav({
  company,
  companies,
  consoleEnabled,
  consoleMode,
  location,
  locations,
  pinnedInUser
}: UserNavProps) {
  const { isMobile } = useSidebar();
  const {
    stationName,
    mode,
    modePreference,
    onModeChange,
    updateLocation,
    switchCompany,
    switchOperator,
    toggleConsoleMode,
    optimisticLocation,
    itarDisclosure,
    isOperatorPinnedIn,
    showingOperator,
    displayName,
    displayAvatar
  } = useUserNav({ consoleMode, location, pinnedInUser });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <NavRailItem
            icon={
              <Avatar
                size="xs"
                src={displayAvatar ?? undefined}
                name={displayName}
              />
            }
            label={displayName}
            trailing={<LuChevronDown className="size-4" />}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-56 rounded-lg"
          side={isMobile ? "bottom" : "right"}
          align="end"
          sideOffset={4}
        >
          {/* Console mode with pinned-in operator: simplified menu */}
          {showingOperator ? (
            <>
              <DropdownMenuLabel>{showingOperator.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={switchOperator}>
                <DropdownMenuIcon icon={<LuUsers />} />
                <Trans>Switch Operator</Trans>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                <Trans>Station: {stationName}</Trans>
              </DropdownMenuLabel>
            </>
          ) : (
            <>
              <DropdownMenuLabel>
                <Trans>Signed in as {stationName}</Trans>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={path.to.accountSettings}>
                  <DropdownMenuIcon icon={<LuUser />} />
                  <Trans>Account Settings</Trans>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <DropdownMenuIcon icon={<LuBuilding />} />
                  <Trans>Company</Trans>
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
                          onSelect={() => switchCompany(c.companyId!)}
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
              {locations.length > 1 ? (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <DropdownMenuIcon icon={<LuMapPin />} />
                      <Trans>Location</Trans>
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
            </>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DropdownMenuIcon
                icon={mode === "dark" ? <LuMoon /> : <LuSun />}
              />
              <Trans>Appearance</Trans>
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
                  <Trans>Light</Trans>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="dark"
                  onSelect={(e) => e.preventDefault()}
                >
                  <DropdownMenuIcon icon={<LuMoon />} />
                  <Trans>Dark</Trans>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="system"
                  onSelect={(e) => e.preventDefault()}
                >
                  <DropdownMenuIcon icon={<LuLaptop />} />
                  <Trans>System</Trans>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {!isOperatorPinnedIn && (
            <>
              {consoleEnabled && (
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center justify-start">
                      <DropdownMenuIcon icon={<LuMonitor />} />
                      <Trans>Console Mode</Trans>
                    </div>
                    <Switch
                      checked={consoleMode}
                      onCheckedChange={toggleConsoleMode}
                    />
                  </div>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {CONTROLLED_ENVIRONMENT && (
                <DropdownMenuItem onClick={itarDisclosure.onOpen}>
                  <DropdownMenuIcon icon={<LuShieldCheck />} />
                  <Trans>About</Trans>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Form method="post" action={path.to.logout}>
                  <button type="submit" className="w-full flex items-center">
                    <DropdownMenuIcon icon={<LuLogOut />} />
                    <span>
                      <Trans>Sign Out</Trans>
                    </span>
                  </button>
                </Form>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {CONTROLLED_ENVIRONMENT && <ItarDisclosure disclosure={itarDisclosure} />}
    </>
  );
}
