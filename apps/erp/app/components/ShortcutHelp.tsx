import type { ShortcutHelpEntry } from "@carbon/react";
import { ShortcutHelpOverlay } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { useModules, useSettingsModule } from "~/hooks";
import {
  DETAIL_TAB_SHORTCUTS,
  EXPLORER_SHORTCUTS,
  MODULE_GO_TO,
  MODULE_GO_TO_PREFIX,
  PAGINATION_SHORTCUTS,
  SHORTCUTS,
  searchShortcut
} from "~/shortcuts";

/**
 * ERP `?` help overlay. Every entry is built from the central shortcut
 * definitions in ~/shortcuts — never write a combo literal here.
 */
const ShortcutHelp = () => {
  const { t } = useLingui();
  const modules = useModules();
  const settingsModule = useSettingsModule();

  const entries = useMemo<ShortcutHelpEntry[]>(() => {
    const general = t`General`;
    const navigation = t`Navigation`;
    const goTo = t`Go to module`;

    const moduleEntries: ShortcutHelpEntry[] = (
      settingsModule ? [...modules, settingsModule] : modules
    ).flatMap((module) => {
      const letter = MODULE_GO_TO[module.key];
      return letter
        ? [
            {
              shortcut: [MODULE_GO_TO_PREFIX, letter],
              description: module.name,
              group: goTo
            }
          ]
        : [];
    });

    return [
      { shortcut: searchShortcut, description: t`Search`, group: general },
      {
        shortcut: SHORTCUTS.save,
        description: t`Save the form you're editing`,
        group: general
      },
      {
        shortcut: SHORTCUTS.confirm,
        description: t`Confirm a dialog`,
        group: general
      },
      {
        shortcut: SHORTCUTS.newRecord,
        description: t`New record (on list pages)`,
        group: general
      },
      {
        shortcut: SHORTCUTS.sidebarToggle,
        description: t`Toggle the sidebar`,
        group: general
      },
      {
        shortcut: SHORTCUTS.help,
        description: t`Show this overlay`,
        group: general
      },
      {
        shortcut: PAGINATION_SHORTCUTS.previous,
        description: t`Previous page (in tables)`,
        group: navigation
      },
      {
        shortcut: PAGINATION_SHORTCUTS.next,
        description: t`Next page (in tables)`,
        group: navigation
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.details,
        description: t`Jump to a section on detail pages (same modifiers + the section's letter)`,
        group: navigation
      },
      {
        shortcut: EXPLORER_SHORTCUTS.addLine,
        description: t`Add a line (in document explorers)`,
        group: navigation
      },
      {
        shortcut: EXPLORER_SHORTCUTS.addAttribute,
        description: t`Add a step or question (in procedure and training explorers)`,
        group: navigation
      },
      {
        shortcut: EXPLORER_SHORTCUTS.addParameter,
        description: t`Add a parameter (in the procedure explorer)`,
        group: navigation
      },
      ...moduleEntries
    ];
  }, [t, modules, settingsModule]);

  return (
    <ShortcutHelpOverlay
      title={t`Keyboard shortcuts`}
      entries={entries}
      emptyLabel={t`No shortcuts available on this page.`}
    />
  );
};

export default ShortcutHelp;
