// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Avatar as AvatarBase,
  Badge,
  DockFinder,
  DockFinderGroup,
  DockFinderItem,
  DockFinderSeparator,
  DockMenu,
  DockMenuContent,
  DockMenuPanel,
  DockMenuSection,
  DockSwitcher,
  dockMenuRowClassName,
  PrefetchLink,
  useMode
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuBell,
  LuChevronRight,
  LuHouse,
  LuLayoutGrid,
  LuPlus
} from "react-icons/lu";
import { useLocation, useMatches, useNavigate, useSubmit } from "react-router";
import { Avatar } from "~/components";
import { useUser } from "~/hooks";
import {
  getImplementationNavItem,
  ImplementationData
} from "~/hooks/useImplementationNavItem";
import {
  useAllModules,
  useModules,
  useSettingsModule
} from "~/hooks/useModules";
import { path } from "~/utils/path";
import { useCompactModuleSidebar } from "../Navigation/CollapsibleSidebar";
import { getModule } from "../Navigation/PrimaryNavigation";
import {
  SheetNavStyleProvider,
  SidebarPresentationProvider
} from "../Navigation/SidebarPresentation";
import { AddCompanyModal } from "../Topbar/AddCompanyModal";
import {
  useCompanyGroups,
  useCompanySwitchRedirect
} from "../Topbar/CompanySwitcher";

/** The switcher whose finder covers the menu, if any. */
type Finder = "companies" | "modules";

/**
 * The module the page belongs to: by its URL, else by a route's
 * `handle.module` (a record's page lives outside its module's URL). Hidden
 * modules count, so the switcher still names where you are.
 */
function useCurrentModule() {
  const { pathname } = useLocation();
  const matches = useMatches();
  const modules = useAllModules();
  const settingsModule = useSettingsModule();
  const all = settingsModule ? [...modules, settingsModule] : modules;

  const segment = getModule(pathname);
  const byPath = all.find((m) => getModule(m.to) === segment);
  if (byPath) return byPath;

  const handled = matches
    .map((match) => (match.handle as { module?: string } | undefined)?.module)
    .filter((m): m is string => typeof m === "string");
  return all.find((m) => handled.includes(getModule(m.to))) ?? null;
}

/** A panel row with an icon tile, as the desktop rail draws modules. */
function MenuRowContent({
  icon,
  label,
  trailing
}: {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <>
      {icon ? (
        <span className="flex size-5 items-center justify-center [&>svg]:size-[18px]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </>
  );
}

/** Home, Get Started while onboarding, the modules in rail order, Settings. */
function ModuleRows({ currentKey }: { currentKey: string | null }) {
  const { i18n } = useLingui();
  const { pathname } = useLocation();
  const modules = useModules();
  const settingsModule = useSettingsModule();
  const isHome = pathname === path.to.authenticatedRoot;

  const row = (
    key: string,
    to: string,
    Icon: IconType,
    name: ReactNode,
    isActive: boolean
  ) => (
    <PrefetchLink
      key={key}
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={dockMenuRowClassName}
    >
      <MenuRowContent icon={<Icon />} label={name} />
    </PrefetchLink>
  );

  return (
    <>
      <DockMenuSection>
        {row(
          "home",
          path.to.authenticatedRoot,
          LuHouse,
          <Trans>Home</Trans>,
          isHome
        )}
        <ImplementationData>
          {(data) => {
            const item = getImplementationNavItem(data, i18n);
            return item
              ? row(
                  "get-started",
                  item.to,
                  item.icon,
                  item.name,
                  getModule(pathname) === getModule(item.to)
                )
              : null;
          }}
        </ImplementationData>
        {modules.map((module) =>
          row(
            module.key,
            module.to,
            module.icon,
            module.name,
            !isHome && currentKey === module.key
          )
        )}
      </DockMenuSection>
      {settingsModule ? (
        <DockMenuSection>
          {row(
            settingsModule.key,
            settingsModule.to,
            settingsModule.icon,
            settingsModule.name,
            currentKey === settingsModule.key
          )}
        </DockMenuSection>
      ) : null}
    </>
  );
}

/**
 * The company switcher's finder: every company the user belongs to, the
 * current one ticked, then Add Company for an admin (the desktop
 * breadcrumb's rule). Picking a company switches to it.
 */
function CompanyFinder({
  onClose,
  onAddCompany
}: {
  onClose: () => void;
  onAddCompany: () => void;
}) {
  const { t } = useLingui();
  const mode = useMode();
  const user = useUser();
  const companyGroups = useCompanyGroups();
  const switchRedirect = useCompanySwitchRedirect();
  const submit = useSubmit();

  return (
    <DockFinder
      placeholder={t`Find company…`}
      closeLabel={t`Back to menu`}
      emptyLabel={<Trans>No companies found</Trans>}
      onClose={onClose}
    >
      {companyGroups.map((group) => (
        <DockFinderGroup
          key={group.name}
          heading={companyGroups.length > 1 ? group.name : undefined}
        >
          {group.companies.map((company) => {
            const logo =
              mode === "dark" ? company.logoDarkIcon : company.logoLightIcon;
            const isCurrent = company.companyId === user.company.id;
            return (
              <DockFinderItem
                key={company.companyId}
                value={`${company.name} ${company.companyId}`}
                icon={
                  <AvatarBase
                    size="xs"
                    name={company.name ?? undefined}
                    src={logo ?? undefined}
                  />
                }
                label={company.name}
                badge={
                  company.employeeType ? (
                    <Badge variant="secondary">{company.employeeType}</Badge>
                  ) : undefined
                }
                isCurrent={isCurrent}
                onSelect={() => {
                  if (isCurrent) {
                    onClose();
                    return;
                  }
                  submit(switchRedirect ? { redirectTo: switchRedirect } : {}, {
                    method: "post",
                    action: path.to.companySwitch(company.companyId!)
                  });
                }}
              />
            );
          })}
        </DockFinderGroup>
      ))}
      {user.admin ? (
        <>
          <DockFinderSeparator />
          <DockFinderItem
            value={t`Add Company`}
            icon={<LuPlus />}
            label={<Trans>Add Company</Trans>}
            onSelect={onAddCompany}
          />
        </>
      ) : null}
    </DockFinder>
  );
}

/** The module switcher's finder: the modules in rail order, then Settings. */
function ModuleFinder({
  currentKey,
  onClose,
  onPick
}: {
  currentKey: string | null;
  onClose: () => void;
  onPick: (to: string) => void;
}) {
  const { t } = useLingui();
  const modules = useModules();
  const settingsModule = useSettingsModule();
  const all = settingsModule ? [...modules, settingsModule] : modules;

  return (
    <DockFinder
      placeholder={t`Find module…`}
      closeLabel={t`Back to menu`}
      emptyLabel={<Trans>No modules found</Trans>}
      onClose={onClose}
    >
      <DockFinderGroup>
        {all.map((module) => (
          <DockFinderItem
            key={module.key}
            value={`${module.name} ${module.key}`}
            icon={<module.icon />}
            label={module.name}
            isCurrent={module.key === currentKey}
            onSelect={() => onPick(module.to)}
          />
        ))}
      </DockFinderGroup>
    </DockFinder>
  );
}

/**
 * The dock's menu: the company and module switchers over one panel. The
 * panel lists the modules on Home and the current module's sections inside
 * a module — the same sidebar the desktop shows — then the account and
 * notifications. Picking a row navigates; any navigation closes the menu.
 * A switcher's name links to its scope and its ⇕ opens a full-screen finder;
 * Esc returns from the finder to the menu.
 */
export function MobileMenu({
  open,
  onOpenChange,
  dock,
  unread,
  onOpenProfile,
  onOpenNotifications
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dock: ReactNode;
  unread: number;
  onOpenProfile: () => void;
  onOpenNotifications: () => void;
}) {
  const { t } = useLingui();
  const mode = useMode();
  const user = useUser();
  const navigate = useNavigate();
  const companyGroups = useCompanyGroups();
  const Sidebar = useCompactModuleSidebar();
  const current = useCurrentModule();
  const [finder, setFinder] = useState<Finder | null>(null);
  const [addingCompany, setAddingCompany] = useState(false);

  // Every opening starts on the menu itself.
  useEffect(() => {
    if (open) setFinder(null);
  }, [open]);

  const companyCount = companyGroups.reduce(
    (sum, group) => sum + group.companies.length,
    0
  );
  // An admin can always add a company, so the finder has a use even with one.
  const canSwitchCompany = companyCount > 1 || user.admin;
  const companyLogo =
    mode === "dark" ? user.company.logoDarkIcon : user.company.logoLightIcon;
  const closeFinder = () => setFinder(null);
  const name = `${user.firstName} ${user.lastName}`;

  return (
    <>
      <DockMenu open={open} onOpenChange={onOpenChange}>
        <DockMenuContent
          label={t`Menu`}
          dock={dock}
          // A tap on a link closes the menu even when it leads to the page
          // already open, where the path (and so the menu) would not change.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) onOpenChange(false);
          }}
          onEscapeKeyDown={(event) => {
            if (finder) {
              event.preventDefault();
              closeFinder();
            }
          }}
          finder={
            finder === "companies" ? (
              <CompanyFinder
                onClose={closeFinder}
                onAddCompany={() => {
                  onOpenChange(false);
                  setAddingCompany(true);
                }}
              />
            ) : finder === "modules" ? (
              <ModuleFinder
                currentKey={current?.key ?? null}
                onClose={closeFinder}
                onPick={(to) => {
                  onOpenChange(false);
                  navigate(to);
                }}
              />
            ) : undefined
          }
        >
          <div className="flex min-w-0 shrink-0 gap-2">
            <DockSwitcher
              icon={
                <AvatarBase
                  size="xs"
                  name={user.company.name}
                  src={companyLogo ?? undefined}
                />
              }
              label={user.company.name}
              to={path.to.authenticatedRoot}
              switchLabel={t`Switch company`}
              onSwitch={
                canSwitchCompany ? () => setFinder("companies") : undefined
              }
            />
            <DockSwitcher
              icon={current ? <current.icon /> : <LuLayoutGrid />}
              label={current?.name ?? <Trans>All modules</Trans>}
              to={current?.to ?? path.to.authenticatedRoot}
              switchLabel={t`Switch module`}
              onSwitch={() => setFinder("modules")}
              // Module names are short; the company name truncates instead.
              className="shrink-0"
            />
          </div>
          <DockMenuPanel>
            {Sidebar ? (
              <SidebarPresentationProvider value="sheet">
                <SheetNavStyleProvider value="menu">
                  <Sidebar />
                </SheetNavStyleProvider>
              </SidebarPresentationProvider>
            ) : (
              <ModuleRows currentKey={current?.key ?? null} />
            )}
            <DockMenuSection>
              <button
                type="button"
                onClick={onOpenProfile}
                className={dockMenuRowClassName}
              >
                <Avatar path={user.avatarUrl} name={name} size="xs" />
                <span className="flex min-w-0 flex-1 flex-col py-1.5">
                  <span className="truncate text-foreground">{name}</span>
                  <span className="truncate text-sm">{user.email}</span>
                </span>
                <LuChevronRight className="size-5" />
              </button>
            </DockMenuSection>
            <DockMenuSection>
              <button
                type="button"
                onClick={onOpenNotifications}
                className={dockMenuRowClassName}
              >
                <MenuRowContent
                  label={
                    <>
                      <Trans>Notifications</Trans>
                      {unread > 0 ? (
                        <span className="sr-only">
                          {" "}
                          <Trans>{unread} unread</Trans>
                        </span>
                      ) : null}
                    </>
                  }
                  trailing={
                    <span className="relative flex size-5 items-center justify-center">
                      <LuBell className="size-[18px]" />
                      {unread > 0 ? (
                        <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-popover" />
                      ) : null}
                    </span>
                  }
                />
              </button>
            </DockMenuSection>
          </DockMenuPanel>
        </DockMenuContent>
      </DockMenu>
      {user.admin ? (
        <AddCompanyModal
          open={addingCompany}
          onClose={() => setAddingCompany(false)}
        />
      ) : null}
    </>
  );
}
