// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAccountSettings } from "@carbon/account";
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
  ItarDisclosure,
  NavRailItem,
  Switch,
  useDisclosure,
  useMode,
  useModePreference,
  useRouteData,
  useSidebar
} from "@carbon/react";
import { modeValidator, ROOT_ACTION_SAVE } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import {
  LuChevronDown,
  LuLaptop,
  LuLogOut,
  LuMonitor,
  LuMoon,
  LuShieldCheck,
  LuSun,
  LuUser,
  LuUsers
} from "react-icons/lu";
import { useFetcher, useNavigation, useSubmit } from "react-router";
import { useUser } from "~/hooks";
import type { action } from "~/root";
import type { Location } from "~/services/types";
import type { PinnedInUser } from "~/types";
import { path } from "~/utils/path";

type UserNavProps = {
  consoleEnabled?: boolean;
  consoleMode: boolean;
  location: string;
  locations: Location[];
  pinnedInUser: PinnedInUser | null;
};

/**
 * Switches the session to another of the user's companies. A navigation, not
 * a fetcher: the shell's `shouldRevalidate` re-runs only after a mutation, and
 * a fetcher's redirect reaches it as a plain GET, so the page kept showing the
 * old company until a reload.
 */
export function useSwitchCompany() {
  const submit = useSubmit();
  return (companyId: string) => {
    const form = new FormData();
    form.append("companyId", companyId);
    submit(form, {
      method: "post",
      action: path.to.switchCompany(companyId)
    });
  };
}

/**
 * Switches the session's location. The pending choice shows at once, as
 * `optimisticLocation`, until the shell re-runs.
 */
export function useLocationSwitch(location: string) {
  const submit = useSubmit();
  const navigation = useNavigation();

  // A navigation, not a fetcher (see useSwitchCompany): the action redirects
  // twice, and a fetcher's submission is dropped on the second redirect, so
  // the shell never re-ran and the menu kept the old location checked.
  const updateLocation = (value: string) => {
    const formData = new FormData();
    formData.append("location", value);
    submit(formData, { method: "POST", action: path.to.location });
  };

  const pendingLocation =
    navigation.formAction === path.to.location
      ? (navigation.formData?.get("location") as string | null)
      : null;

  return { updateLocation, optimisticLocation: pendingLocation ?? location };
}

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
    fetcher.submit(formData, ROOT_ACTION_SAVE);
  };

  const switchCompany = useSwitchCompany();

  const switchOperator = () => {
    fetcher.submit(null, { method: "POST", action: path.to.consolePinOut });
  };

  const toggleConsoleMode = () => {
    const formData = new FormData();
    formData.append("consoleMode", consoleMode ? "false" : "true");
    fetcher.submit(formData, { method: "post", action: path.to.consoleToggle });
  };

  const { updateLocation, optimisticLocation } = useLocationSwitch(location);

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
  const showingOperator = isOperatorPinnedIn ? pinnedInUser : null;
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
  consoleEnabled,
  consoleMode,
  pinnedInUser
}: Omit<UserNavProps, "location" | "locations">) {
  const { t } = useLingui();
  const submit = useSubmit();
  const { isMobile } = useSidebar();
  const openAccountSettings = useAccountSettings((s) => s.open);
  // The settings dialog opens from a menu item that no longer exists when it
  // closes, so focus would fall to <body>. Return it to the account trigger.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedFromMenuRef = useRef(false);
  const accountSettingsOpen = useAccountSettings((s) => s.tab !== null);
  useEffect(() => {
    if (accountSettingsOpen || !openedFromMenuRef.current) return;
    openedFromMenuRef.current = false;
    // After the dialog's own focus restore, which runs on a timeout.
    const timer = setTimeout(() => triggerRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [accountSettingsOpen]);
  const {
    stationName,
    mode,
    modePreference,
    onModeChange,
    switchOperator,
    toggleConsoleMode,
    itarDisclosure,
    isOperatorPinnedIn,
    showingOperator,
    displayName,
    displayAvatar
  } = useUserNav({ consoleMode, location: "", pinnedInUser });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <NavRailItem
            ref={triggerRef}
            icon={
              <Avatar
                size="xs"
                src={displayAvatar ?? undefined}
                name={displayName}
              />
            }
            label={displayName}
            aria-label={t`Account: ${displayName.trim()}`}
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
              <DropdownMenuItem
                onClick={() => {
                  openedFromMenuRef.current = true;
                  openAccountSettings();
                }}
              >
                <DropdownMenuIcon icon={<LuUser />} />
                <Trans>Account Settings</Trans>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {/* The account settings modal is the station's account, which a
              pinned-in operator never opens: they keep the mode picker. */}
          {showingOperator ? (
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
          ) : (
            <DropdownMenuItem onClick={() => openAccountSettings("appearance")}>
              <DropdownMenuIcon
                icon={mode === "dark" ? <LuMoon /> : <LuSun />}
              />
              <Trans>Appearance</Trans>
            </DropdownMenuItem>
          )}
          {!isOperatorPinnedIn && (
            <>
              {consoleEnabled && (
                // The item itself is the toggle; the switch only shows its state.
                <DropdownMenuItem
                  role="menuitemcheckbox"
                  aria-checked={consoleMode}
                  onSelect={(e) => {
                    e.preventDefault();
                    toggleConsoleMode();
                  }}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center justify-start">
                      <DropdownMenuIcon icon={<LuMonitor />} />
                      <Trans>Console Mode</Trans>
                    </div>
                    <Switch
                      aria-hidden
                      tabIndex={-1}
                      className="pointer-events-none"
                      checked={consoleMode}
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
              <DropdownMenuItem
                onSelect={() =>
                  submit(null, { method: "post", action: path.to.logout })
                }
              >
                <DropdownMenuIcon icon={<LuLogOut />} />
                <Trans>Sign Out</Trans>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {CONTROLLED_ENVIRONMENT && <ItarDisclosure disclosure={itarDisclosure} />}
    </>
  );
}
