// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
import { memo, useMemo } from "react";
import { LuSearch, LuSettings2 } from "react-icons/lu";
import { useLocation, useMatches, useNavigate } from "react-router";
import {
  useModules,
  useOptimisticLocation,
  usePermissions,
  useSettingsModule
} from "~/hooks";
import {
  getImplementationNavItem,
  ImplementationData
} from "~/hooks/useImplementationNavItem";
import {
  MODULE_GO_TO,
  MODULE_GO_TO_PREFIX,
  navigationEditCancelShortcut,
  searchShortcut
} from "~/shortcuts";
import { useUIStore } from "~/stores/ui";
import type { Authenticated, NavItem } from "~/types";
import { SearchModal } from "../Topbar/Search";
import { HiddenModulesPopover } from "./HiddenModulesPopover";
import { NavigationEditBar } from "./NavigationEditBar";
import { SortableNavItem } from "./SortableNavItem";
import { useNavigationEditMode } from "./useNavigationEditMode";

// Module constants: a new options object makes a new sensor, and with it new
// listeners for every draggable on every render.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };

// Search and Customize are actions, not destinations — they keep the neutral
// accent hover instead of the active-tinted one module links use.
const ACTION_HOVER = "hover:bg-accent hover:text-accent-foreground";

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
    isActive={isActive}
    trailing={goToKey ? <GoToHint goToKey={goToKey} /> : undefined}
  />
);

const PrimaryNavigation = () => {
  const { t, i18n } = useLingui();
  const { isMobile } = useSidebar();
  const permissions = usePermissions();
  const committedModule = getModule(useLocation().pathname);
  const pendingModule = getModule(useOptimisticLocation().pathname);
  const links = useModules();
  const settingsModule = useSettingsModule();
  const matchedModules = useMatches().reduce((acc, match) => {
    const handle = match.handle as { module?: string } | undefined;

    if (handle && typeof handle.module === "string") {
      acc.add(handle.module);
    }

    return acc;
  }, new Set<string>());

  // While a navigation is pending the highlight moves to the destination at
  // once, and off the module being left: `matchedModules` still describes the
  // page on screen, so honouring both lit two modules for the length of the
  // loader. A destination that is no module's own path (a detail page, whose
  // module is only known from its route handle) keeps the current highlight.
  const pendingIsModule =
    pendingModule !== committedModule &&
    (pendingModule === "get-started" ||
      [...links, settingsModule].some(
        (link) => link && getModule(link.to) === pendingModule
      ));
  const currentModule = pendingIsModule ? pendingModule : committedModule;
  const isModuleActive = (to: string) => {
    const m = getModule(to);
    return currentModule === m || (!pendingIsModule && matchedModules.has(m));
  };

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

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor)
  );

  const footer = (
    <>
      {settingsModule && !editMode.isEditing
        ? renderLink(
            settingsModule,
            isModuleActive(settingsModule.to),
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
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
                  onToggleHidden={editMode.toggleHidden}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          links.map((link) =>
            renderLink(link, isModuleActive(link.to), MODULE_GO_TO[link.key])
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
      className={ACTION_HOVER}
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

export function getModule(link: string) {
  return link.split("/")?.[2];
}
