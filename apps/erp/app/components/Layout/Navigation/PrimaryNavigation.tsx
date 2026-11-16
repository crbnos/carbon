// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { moduleOf, pageOfUrl } from "@carbon/database/access";
import {
  cn,
  NavRail,
  NavRailItem,
  NavRailLink,
  ShortcutKey,
  useShortcutKeys,
  useShortcutSequence,
  useSidebar
} from "@carbon/react";
import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
import { memo, useMemo, useState } from "react";
import { LuSearch, LuSettings2 } from "react-icons/lu";
import { useLocation, useMatches, useNavigate } from "react-router";
import {
  useOptimisticLocation,
  usePermissions,
  useSettingsModule
} from "~/hooks";
import {
  getImplementationNavItem,
  ImplementationData
} from "~/hooks/useImplementationNavItem";
import {
  useModuleLinks,
  useModuleSubmodules
} from "~/hooks/useModuleSubmodules";
import {
  MODULE_GO_TO,
  MODULE_GO_TO_PREFIX,
  navigationEditCancelShortcut,
  searchShortcut
} from "~/shortcuts";
import { useUIStore } from "~/stores/ui";
import type { Authenticated, NavItem } from "~/types";
import { POINTER_SENSOR_OPTIONS } from "~/utils/drag-sensors";
import { moduleOfMatches } from "~/utils/nav";
import { getModule } from "~/utils/submodule-visibility";
import { SearchModal } from "../Topbar/Search";
import CompanySwitcher from "./CompanySwitcher";
import { HiddenModulesPopover } from "./HiddenModulesPopover";
import { NavigationEditBar } from "./NavigationEditBar";
import { SortableNavItem } from "./SortableNavItem";
import { useNavigationEditMode } from "./useNavigationEditMode";

// A row with an open tree is tall, so its center is far from its row. Follow the
// pointer instead. The keyboard has no pointer, and a gap between rows has no row.
const moduleUnderPointer: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  return collisions.length > 0 ? collisions : closestCenter(args);
};

// Search and Customize are actions, not destinations — they keep the neutral
// accent hover instead of the active-tinted one module links use.
const ACTION_HOVER = "hover:bg-accent hover:text-accent-foreground";

// Expanded, Search reads as a field: an inset hairline rather than a border,
// which would push its icon a pixel off the rail's icon column. Collapsed, it
// is an icon like the rest.
const SEARCH_BORDER =
  "group-data-[state=expanded]:shadow-[inset_0_0_0_1px_hsl(var(--border))]";

// Only modules have a g-then-letter key; pass it for those.
const renderLink = (
  link: Authenticated<NavItem>,
  isActive: boolean,
  goToKey?: string
) => (
  <NavRailLink
    key={link.name}
    to={link.to}
    icon={<link.icon />}
    label={link.name}
    tag={link.tag}
    external={link.external}
    target={link.newTab ? "_blank" : undefined}
    rel={link.newTab ? "noopener noreferrer" : undefined}
    isActive={isActive}
    trailing={goToKey ? <GoToHint goToKey={goToKey} /> : undefined}
  />
);

const PrimaryNavigation = () => {
  const { t, i18n } = useLingui();
  const { isMobile } = useSidebar();
  const permissions = usePermissions();
  const { pathname } = useLocation();
  const pendingPathname = useOptimisticLocation().pathname;
  const links = useModuleLinks();
  const settingsModule = useSettingsModule();
  const committedModule = moduleOfMatches(useMatches());

  // While a navigation is pending the highlight moves to the destination at
  // once. The routes of a pending URL are not matched yet, so only a URL
  // inside a module's own path counts, and only when its page is in that
  // module; a record's page keeps the current highlight until it loads.
  const pendingModule = useMemo(() => {
    if (pendingPathname === pathname) return undefined;
    const segment = getModule(pendingPathname);
    if (segment === "get-started") return segment;
    const link = [...links, settingsModule].find(
      (l) => l && getModule(l.to) === segment
    );
    const page = pageOfUrl(pendingPathname);
    return link && (!page || moduleOf(page) === link.key)
      ? link.key
      : undefined;
  }, [pathname, pendingPathname, links, settingsModule]);
  const currentModule = pendingModule ?? committedModule;
  const isModuleActive = (key: string) => currentModule === key;

  const editMode = useNavigationEditMode();

  // g-then-letter module go-to, bound to the stable module `key` (order and
  // visibility are per-user, so positions would be unstable).
  const navigate = useNavigate();
  const goToModules = useMemo(() => {
    const map: Record<string, () => void> = {};
    const targets = settingsModule ? [...links, settingsModule] : links;
    for (const module of targets) {
      const letter = MODULE_GO_TO[module.key];
      if (letter) map[letter] = () => navigate(module.to);
    }
    return map;
  }, [links, settingsModule, navigate]);
  // Disabled while rearranging the rail — a stray `g`+letter would navigate
  // away and discard the unsaved layout.
  useShortcutSequence({
    prefix: MODULE_GO_TO_PREFIX,
    map: goToModules,
    disabled: editMode.isEditing
  });

  useShortcutKeys({
    shortcut: navigationEditCancelShortcut,
    action: editMode.cancelEditMode,
    disabled: !editMode.isEditing
  });

  // Hover is off while the search modal owns the pointer or the rail is being
  // rearranged; flipping it back also clears any hover left over from either.
  const isSearchModalOpen = useUIStore((s) => s.isSearchModalOpen);

  const footer = (
    <>
      {settingsModule && !editMode.isEditing
        ? renderLink(
            settingsModule,
            isModuleActive(settingsModule.key),
            MODULE_GO_TO[settingsModule.key]
          )
        : null}

      {editMode.isEditing ? (
        <NavigationEditBar
          isSaving={editMode.isSaving}
          isDirty={editMode.isDirty}
          onSave={editMode.save}
          onCancel={editMode.cancelEditMode}
        />
      ) : isMobile ? null : (
        <NavRailItem
          icon={<LuSettings2 />}
          label={t`Customize`}
          onClick={editMode.enterEditMode}
          className={ACTION_HOVER}
          data-hover-tone="accent"
        />
      )}
    </>
  );

  const canSearch = permissions.is("employee");

  return (
    <>
      <NavRail
        forceExpanded={editMode.isEditing}
        disableHover={editMode.isEditing || isSearchModalOpen}
        // Phones switch company from the Profile sheet.
        header={isMobile ? undefined : <CompanySwitcher />}
        footer={footer}
      >
        {canSearch && <NavigationSearchButton />}
        {editMode.isEditing ? null : (
          <ImplementationData>
            {(data) => {
              const item = getImplementationNavItem(data, i18n);
              return item
                ? renderLink(item, currentModule === "get-started")
                : null;
            }}
          </ImplementationData>
        )}
        {editMode.isEditing ? (
          <CustomizeModuleList
            editMode={editMode}
            currentModule={currentModule}
          />
        ) : (
          links.map((link) =>
            renderLink(link, isModuleActive(link.key), MODULE_GO_TO[link.key])
          )
        )}

        {editMode.isEditing && (
          <HiddenModulesPopover
            hiddenModules={editMode.hiddenDraft}
            onToggleHidden={editMode.toggleHidden}
          />
        )}
      </NavRail>
      {/* Outside the rail: on phones the rail is a drawer that unmounts when
          closed, and ⌘K plus the modal must outlive it. */}
      {canSearch && <GlobalSearch />}
    </>
  );
};

// Mounted only while Customize is open, so the tree state starts fresh each time.
const CustomizeModuleList = ({
  editMode,
  currentModule
}: {
  editMode: ReturnType<typeof useNavigationEditMode>;
  currentModule: string | undefined;
}) => {
  const submodules = useModuleSubmodules();
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor)
  );
  const [openModules, setOpenModules] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        editMode.visibleDraft
          .filter((m) => m.key === currentModule)
          .map((m) => m.key)
      )
  );
  const toggleOpen = (key: string) => {
    setOpenModules((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={moduleUnderPointer}
      onDragEnd={editMode.handleDragEnd}
    >
      <SortableContext
        items={editMode.visibleDraft.map((m) => m.key)}
        strategy={verticalListSortingStrategy}
      >
        {editMode.visibleDraft.map((module) => (
          <SortableNavItem
            key={module.key}
            module={module}
            groups={submodules[module.key] ?? []}
            isOpen={openModules.has(module.key)}
            onToggleOpen={toggleOpen}
            onToggleHidden={editMode.toggleHidden}
            onSetSubmodulesHidden={editMode.setSubmodulesHidden}
            onSetSubmoduleOrder={editMode.setSubmoduleOrder}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
};

// Hovering is what expands the rail, so the g-then-letter hint shows on the
// hovered/focused row only.
const GoToHint = ({ goToKey }: { goToKey: string }) => (
  <span
    aria-hidden
    className={cn(
      "flex items-center gap-0.5 opacity-0 transition-opacity duration-100",
      "group-hover/item:opacity-100 group-focus-visible/item:opacity-100"
    )}
  >
    <ShortcutKey
      shortcut={MODULE_GO_TO_PREFIX}
      variant="small"
      className="mx-0"
    />
    <ShortcutKey shortcut={goToKey} variant="small" className="mx-0" />
  </span>
);

const NavigationSearchButton = () => {
  const { t } = useLingui();
  const openSearchModal = useUIStore((s) => s.openSearchModal);
  const { setOpenMobile } = useSidebar();

  return (
    <NavRailItem
      icon={<LuSearch />}
      label={t`Search`}
      onClick={() => {
        setOpenMobile(false);
        openSearchModal();
      }}
      className={cn(ACTION_HOVER, SEARCH_BORDER)}
      data-hover-tone="accent"
      trailing={
        <ShortcutKey
          shortcut={searchShortcut}
          variant="small"
          className="mx-0"
        />
      }
    />
  );
};

const GlobalSearch = () => {
  const openSearchModal = useUIStore((s) => s.openSearchModal);

  useShortcutKeys({
    shortcut: searchShortcut,
    action: openSearchModal
  });

  return <SearchModal />;
};

export default memo(PrimaryNavigation);
