import {
  cn,
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuMenu, LuSearch, LuSettings } from "react-icons/lu";
import { Link, useMatches } from "react-router";
import {
  useModules,
  useOptimisticLocation,
  usePermissions,
  useSettingsModule
} from "~/hooks";
import { useImplementationNavItem } from "~/hooks/useImplementationNavItem";
import { useUIStore } from "~/stores/ui";
import type { Authenticated, NavItem } from "~/types";
import { getModule } from "./PrimaryNavigation";

/**
 * The primary module navigation for phones and small tablets. The desktop icon
 * rail (`PrimaryNavigation`) is `hidden md:flex` and expands on hover — an
 * interaction that does not exist on touch — so below `md` this hamburger opens
 * a labelled module list in a left drawer instead.
 */
const MobileNavigation = () => {
  const { t } = useLingui();
  const disclosure = useDisclosure();
  const permissions = usePermissions();
  const location = useOptimisticLocation();
  const currentModule = getModule(location.pathname);
  const links = useModules();
  const settingsModule = useSettingsModule();
  const implementationNav = useImplementationNavItem();
  const { openSearchModal } = useUIStore();

  const matchedModules = useMatches().reduce((acc, match) => {
    const handle = match.handle as { module?: string } | undefined;
    if (handle && typeof handle.module === "string") {
      acc.add(handle.module);
    }
    return acc;
  }, new Set<string>());

  const isModuleActive = (to: string) => {
    const m = getModule(to);
    return currentModule === m || matchedModules.has(m);
  };

  return (
    <Drawer
      open={disclosure.isOpen}
      onOpenChange={(open) =>
        open ? disclosure.onOpen() : disclosure.onClose()
      }
    >
      <DrawerTrigger asChild>
        <IconButton
          aria-label={t`Open navigation`}
          icon={<LuMenu />}
          variant="ghost"
        />
      </DrawerTrigger>
      <DrawerContent
        position="left"
        size="content"
        className="w-[17rem] max-w-[85vw] p-0"
      >
        <DrawerTitle className="px-6 py-4">
          <Trans>Navigation</Trans>
        </DrawerTitle>
        <VStack
          spacing={1}
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent px-3 pb-4"
        >
          {permissions.is("employee") && (
            <NavRow
              as="button"
              icon={LuSearch}
              label={t`Search`}
              onClick={() => {
                disclosure.onClose();
                openSearchModal();
              }}
            />
          )}

          {implementationNav ? (
            <NavRow
              icon={implementationNav.icon}
              label={implementationNav.name}
              to={implementationNav.to}
              isActive={currentModule === "get-started"}
              onClick={disclosure.onClose}
            />
          ) : null}

          {links.map((link) => (
            <NavRow
              key={link.name}
              icon={link.icon}
              label={link.name}
              to={link.to}
              external={link.external}
              tag={link.tag}
              isActive={isModuleActive(link.to)}
              onClick={disclosure.onClose}
            />
          ))}

          {settingsModule ? (
            <NavRow
              icon={settingsModule.icon ?? LuSettings}
              label={settingsModule.name}
              to={settingsModule.to}
              isActive={isModuleActive(settingsModule.to)}
              onClick={disclosure.onClose}
            />
          ) : null}
        </VStack>
      </DrawerContent>
    </Drawer>
  );
};

type NavRowProps = {
  icon: NavItem["icon"];
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  tag?: Authenticated<NavItem>["tag"];
} & (
  | { as: "button"; to?: never; external?: never }
  | { as?: "link"; to: string; external?: boolean }
);

const NavRow = ({
  icon: Icon,
  label,
  isActive = false,
  onClick,
  tag,
  ...props
}: NavRowProps) => {
  const classes = cn(
    "relative flex items-center gap-3 w-full rounded-md px-3 py-2.5",
    "text-base font-medium select-none",
    "active:scale-[0.98] transition-[background-color,color,transform] duration-100 ease-out",
    isActive
      ? "bg-active text-active-foreground dark:shadow-button-base"
      : "hover:bg-accent hover:text-accent-foreground"
  );

  const content = (
    <>
      <Icon className="size-5 shrink-0" />
      <span className="flex-1 truncate text-left">{label}</span>
      {tag ? (
        <span className="min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium leading-4 text-center tabular-nums">
          {tag}
        </span>
      ) : null}
    </>
  );

  if (props.as === "button") {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }

  return (
    <Link
      to={props.to}
      onClick={onClick}
      className={classes}
      aria-current={isActive}
      prefetch={props.external ? "none" : "intent"}
      reloadDocument={props.external}
    >
      {content}
    </Link>
  );
};

export default MobileNavigation;
