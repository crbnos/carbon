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
import { useRef } from "react";
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

export function UserNav({
  company,
  companies,
  consoleEnabled,
  consoleMode,
  location,
  locations,
  pinnedInUser
}: {
  company: Company;
  companies: Company[];
  consoleEnabled?: boolean;
  consoleMode: boolean;
  location: string;
  locations: Location[];
  pinnedInUser: PinnedInUser | null;
}) {
  const user = useUser();
  const stationName = `${user.firstName} ${user.lastName}`;
  const { isMobile } = useSidebar();

  const mode = useMode();
  const modePreference = useModePreference();

  const consoleSubmitRef = useRef<HTMLButtonElement>(null);

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

  const optimisticLocation =
    (fetcher.formData?.get("location") as string | undefined) ?? location;

  const itarDisclosure = useDisclosure();

  // useUser().id returns the effective (operator) ID — read the original station user ID directly
  const routeData = useRouteData<{ user: { id: string } | null }>(
    path.to.authenticatedRoot
  );
  const sessionUserId = routeData?.user?.id;
  const isOperatorPinnedIn =
    consoleMode &&
    pinnedInUser &&
    sessionUserId &&
    pinnedInUser.userId !== sessionUserId;
  const showingOperator = consoleMode && pinnedInUser;
  const displayName = showingOperator ? pinnedInUser.name : stationName;
  const displayAvatar = showingOperator
    ? pinnedInUser.avatarUrl
    : user.avatarUrl;

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
              <DropdownMenuLabel>{pinnedInUser.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  fetcher.submit(null, {
                    method: "POST",
                    action: path.to.consolePinOut
                  });
                }}
              >
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
                          onSelect={() => {
                            const form = new FormData();
                            form.append("companyId", c.companyId!);
                            fetcher.submit(form, {
                              method: "post",
                              action: path.to.switchCompany(c.companyId!)
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
                    <div>
                      <Switch
                        checked={consoleMode}
                        onCheckedChange={() =>
                          consoleSubmitRef.current?.click()
                        }
                      />
                      <fetcher.Form
                        action={path.to.consoleToggle}
                        method="post"
                        className="sr-only"
                      >
                        <input
                          type="hidden"
                          name="consoleMode"
                          value={consoleMode ? "false" : "true"}
                        />
                        <button
                          ref={consoleSubmitRef}
                          className="sr-only"
                          type="submit"
                        />
                      </fetcher.Form>
                    </div>
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
