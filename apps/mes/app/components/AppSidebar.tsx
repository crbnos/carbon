"use client";

import type { Company } from "@carbon/auth";
import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import {
  Avatar,
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
  ItarDisclosure,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  Switch,
  useDisclosure,
  useMode,
  useRouteData,
  useSidebar
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import { Suspense, useRef } from "react";
import { BsFillHexagonFill } from "react-icons/bs";
import {
  LuActivity,
  LuBuilding,
  LuCalendarDays,
  LuChevronDown,
  LuCirclePlay,
  LuClipboardList,
  LuHistory,
  LuLogOut,
  LuMapPin,
  LuMonitor,
  LuMoon,
  LuPackageCheck,
  LuShieldCheck,
  LuSun,
  LuUser,
  LuUsers,
  LuWrench
} from "react-icons/lu";
import { Await, Form, Link, useFetcher, useLocation } from "react-router";
import { useUser } from "~/hooks";
import type { action } from "~/root";
import type { Location } from "~/services/types";
import type { PinnedInUser } from "~/types";
import { ERP_URL, path } from "~/utils/path";
import { AdjustInventory } from "./AdjustInventory";
import { EndShift } from "./EndShift";
import Suggestion from "./Suggestion";
import { TimeCardButton } from "./TimeCardButton";

export function AppSidebar({
  activeEvents,
  activeMaintenanceCount,
  company,
  companies,
  consoleEnabled,
  consoleMode,
  location,
  locations,
  openClockEntry,
  pinnedInUser,
  timeCardEnabled,
  ...props
}: ComponentProps<typeof Sidebar> & {
  activeEvents: number;
  activeMaintenanceCount: number;
  company: Company;
  companies: Company[];
  consoleEnabled?: boolean;
  consoleMode: boolean;
  location: string;
  locations: Location[];
  pinnedInUser: PinnedInUser | null;
  timeCardEnabled?: boolean;
  openClockEntry?: Promise<{
    data: { id: string; clockIn: string; [key: string]: unknown } | null;
  }> | null;
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher company={company} />
      </SidebarHeader>
      <SidebarContent>
        <OperationsNav
          activeEvents={activeEvents}
          activeMaintenanceCount={activeMaintenanceCount}
        />
        <ToolsNav />
      </SidebarContent>
      <SidebarFooter>
        {timeCardEnabled && (
          <SidebarMenu>
            <Suspense fallback={<TimeCardButton openClockEntry={null} />}>
              <Await resolve={openClockEntry}>
                {(resolved) => (
                  <TimeCardButton
                    openClockEntry={
                      resolved?.data
                        ? {
                            id: resolved.data.id,
                            clockIn: resolved.data.clockIn
                          }
                        : null
                    }
                  />
                )}
              </Await>
            </Suspense>
          </SidebarMenu>
        )}
        <UserNav
          company={company}
          companies={companies}
          consoleEnabled={consoleEnabled}
          consoleMode={consoleMode}
          location={location}
          locations={locations}
          pinnedInUser={pinnedInUser}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function TeamSwitcher({ company }: { company: Company }) {
  const mode = useMode();
  const companyLogo =
    mode === "dark" ? company.logoDarkIcon : company.logoLightIcon;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          asChild
        >
          <a href={ERP_URL}>
            <div className="flex aspect-square size-10 items-center justify-center rounded-lg text-foreground">
              {companyLogo ? (
                <img
                  src={companyLogo}
                  alt={`${company.name} logo`}
                  className="h-full w-full rounded object-contain"
                />
              ) : (
                <BsFillHexagonFill className="size-6" />
              )}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{company.name}</span>
            </div>
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function OperationsNav({
  activeEvents,
  activeMaintenanceCount
}: {
  activeEvents: number;
  activeMaintenanceCount: number;
}) {
  const { t } = useLingui();
  const links = [
    {
      title: t`Schedule`,
      icon: LuCalendarDays,
      to: path.to.operations
    },
    {
      title: t`Assigned`,
      icon: LuClipboardList,
      to: path.to.assigned
    },
    {
      title: t`Active`,
      icon: LuActivity,
      label: (activeEvents ?? 0).toString(),
      to: path.to.active
    },
    {
      title: t`Recent`,
      icon: LuHistory,
      to: path.to.recent
    },
    {
      title: t`Jobs`,
      icon: LuCirclePlay,
      to: path.to.jobs
    },
    {
      title: t`Maintenance`,
      icon: LuWrench,
      label: (activeMaintenanceCount ?? 0).toString(),
      to: path.to.maintenance
    },
    {
      title: t`Picking`,
      icon: LuPackageCheck,
      to: path.to.picking
    }
  ];

  const location = useLocation();
  const { pathname } = location;
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <Trans>Operations</Trans>
      </SidebarGroupLabel>
      <SidebarMenu>
        {links.map((item) => {
          const isActive =
            pathname.includes(item.to) ||
            (pathname.includes("operations") && item.title === "Schedule");
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                className={cn(
                  item.label &&
                    Number.isInteger(parseInt(item.label)) &&
                    parseInt(item.label) > 0 &&
                    "text-emerald-500"
                )}
                isActive={isActive}
                asChild
              >
                <Link
                  to={item.to}
                  onClick={() => isMobile && setOpenMobile(false)}
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  {item.label && (
                    <span className="ml-auto text-muted-foreground text-sm">
                      {item.label}
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function ToolsNav() {
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>
          <Trans>Inventory Adjustments</Trans>
        </SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <AdjustInventory add={true} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <AdjustInventory add={false} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>
          <Trans>Tools</Trans>
        </SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <EndShift />
          </SidebarMenuItem>

          <SidebarMenuItem>
            <Suggestion />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

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
  const { t } = useLingui();
  const user = useUser();
  const stationName = `${user.firstName} ${user.lastName}`;
  const { isMobile } = useSidebar();

  const mode = useMode();

  const modeSubmitRef = useRef<HTMLButtonElement>(null);
  const consoleSubmitRef = useRef<HTMLButtonElement>(null);

  const fetcher = useFetcher<typeof action>();

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
  const displaySubtext = showingOperator ? t`Console` : user.email;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar
                className="h-8 w-8 rounded-lg"
                src={displayAvatar ?? undefined}
                name={displayName}
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{displayName}</span>
                <span className="truncate text-xs">{displaySubtext}</span>
              </div>
              <LuChevronDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
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
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center justify-start">
                  <DropdownMenuIcon
                    icon={mode === "dark" ? <LuMoon /> : <LuSun />}
                  />
                  <Trans>Dark Mode</Trans>
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
                    <input
                      type="hidden"
                      name="mode"
                      value={mode === "dark" ? "light" : "dark"}
                    />
                    <button
                      ref={modeSubmitRef}
                      className="sr-only"
                      type="submit"
                    />
                  </fetcher.Form>
                </div>
              </div>
            </DropdownMenuItem>
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
      </SidebarMenuItem>
      {CONTROLLED_ENVIRONMENT && <ItarDisclosure disclosure={itarDisclosure} />}
    </SidebarMenu>
  );
}
