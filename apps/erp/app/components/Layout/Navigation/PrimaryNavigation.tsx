// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
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
import { useMatches, useNavigate } from "react-router";
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

// Search and Customize are actions, not destinations — they keep the neutral
// accent hover instead of the active-tinted one module links use.
const ACTION_HOVER = "hover:bg-accent hover:text-accent-foreground";

const renderLink = (link: Authenticated<NavItem>, isActive: boolean) => (
  <NavRailLink
    key={link.name}
    to={link.to}
    icon={<link.icon />}
    label={link.name}
    tag={link.tag}
    external={link.external}
    isActive={isActive}
  />
);

const PrimaryNavigation = () => {
  const { t, i18n } = useLingui();
  const { isMobile } = useSidebar();
  const permissions = usePermissions();
  const location = useOptimisticLocation();
  const currentModule = getModule(location.pathname);
  const links = useModules();
  const settingsModule = useSettingsModule();
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
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const footer = (
    <>
      {settingsModule && !editMode.isEditing
        ? renderLink(settingsModule, isModuleActive(settingsModule.to))
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
          links.map((link) => renderLink(link, isModuleActive(link.to)))
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
