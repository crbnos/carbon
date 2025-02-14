"use client";

import {
  LuActivity,
  LuBuilding,
  LuCalendarDays,
  LuChevronDown,
  LuChevronsUpDown,
  LuClipboardList,
  LuClock,
  LuLogOut,
  LuMapPin,
  LuMoon,
  LuSun,
  LuUser,
} from "react-icons/lu";

import { type Company } from "@carbon/auth";
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
  useSidebar,
} from "@carbon/react";
import { Form, Link, useFetcher, useLocation } from "@remix-run/react";
import { useRef, type ComponentProps } from "react";
import { useMode, useUser } from "~/hooks";
import type { action } from "~/root";
import type { Location } from "~/services/types";
import { path } from "~/utils/path";
import { AdjustInventory } from "./AdjustInventory";
import { EndShift } from "./EndShift";
import Feedback from "./Feedback";
import { BsFillHexagonFill } from "react-icons/bs";

export function AppSidebar({
  activeEvents,
  company,
  companies,
  location,
  locations,
  ...props
}: ComponentProps<typeof Sidebar> & {
  activeEvents: number;
  company: Company;
  companies: Company[];
  location: string;
  locations: Location[];
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher company={company} companies={companies} />
      </SidebarHeader>
      <SidebarContent>
        <OperationsNav activeEvents={activeEvents} />
        <ToolsNav />
      </SidebarContent>
      <SidebarFooter>
        <UserNav
          company={company}
          companies={companies}
          location={location}
          locations={locations}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function TeamSwitcher({
  company,
  companies,
}: {
  company: Company;
  companies: Company[];
}) {
  const { isMobile } = useSidebar();
  const mode = useMode();
  const companyLogo =
    mode === "dark" ? company.logoDarkIcon : company.logoLightIcon;

  const hasMultipleCompanies = Array.isArray(companies) && companies.length > 1;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!hasMultipleCompanies}
            className="disabled:opacity-100"
            asChild
          >
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg text-sidebar-primary-foreground">
                {companyLogo ? (
                  <img
                    src={companyLogo}
                    alt={`${company.name} logo`}
                    className="h-full w-full rounded object-contain"
                  />
                ) : (
                  <BsFillHexagonFill />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{company.name}</span>
              </div>
              {hasMultipleCompanies && <LuChevronsUpDown className="ml-auto" />}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Companies
            </DropdownMenuLabel>
            {companies.map((c, index) => {
              const logo = mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
              return (
                <Form
                  key={c.companyId}
                  method="post"
                  action={path.to.companySwitch(c.companyId!)}
                  className="w-full"
                >
                  <DropdownMenuItem key={c.name} className="gap-2 p-2" asChild>
                    <button type="submit" className="w-full">
                      <Avatar
                        src={logo ?? undefined}
                        name={c.name ?? ""}
                        className="rounded-md object-contain bg-transparent border-none"
                      />
                      {c.name}
                    </button>
                  </DropdownMenuItem>
                </Form>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function OperationsNav({ activeEvents }: { activeEvents: number }) {
  const links = [
    {
      title: "Schedule",
      icon: LuCalendarDays,
      to: path.to.operations,
    },
    {
      title: "Assigned",
      icon: LuClipboardList,
      to: path.to.assigned,
    },
    {
      title: "Active",
      icon: LuActivity,
      label: (activeEvents ?? 0).toString(),
      to: path.to.active,
    },
    {
      title: "Recent",
      icon: LuClock,
      to: path.to.recent,
    },
  ];

  const { pathname } = useLocation();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Operations</SidebarGroupLabel>
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
                <Link to={item.to}>
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
        <SidebarGroupLabel>Inventory Adjustments</SidebarGroupLabel>
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
        <SidebarGroupLabel>Tools</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <EndShift />
          </SidebarMenuItem>

          <SidebarMenuItem>
            <Feedback />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

export function UserNav({
  company,
  companies,
  location,
  locations,
}: {
  company: Company;
  companies: Company[];
  location: string;
  locations: Location[];
}) {
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;
  const { isMobile } = useSidebar();

  const mode = useMode();

  const modeSubmitRef = useRef<HTMLButtonElement>(null);

  const fetcher = useFetcher<typeof action>();

  const updateLocation = (value: string) => {
    const formData = new FormData();
    formData.append("location", value);
    fetcher.submit(formData, { method: "POST", action: path.to.location });
  };

  const optimisticLocation =
    (fetcher.formData?.get("location") as string | undefined) ?? location;
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
                src={user.avatarUrl ?? undefined}
                name={name}
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <LuChevronDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
