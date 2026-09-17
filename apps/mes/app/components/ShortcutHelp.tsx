import type { ShortcutHelpEntry } from "@carbon/react";
import { ShortcutHelpOverlay } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { MES_NAV_SHORTCUTS, SHORTCUTS, START_STOP_SHORTCUT } from "~/shortcuts";

/**
 * MES `?` help overlay. Every entry is built from the central shortcut
 * definitions in ~/shortcuts — never write a combo literal here.
 */
const ShortcutHelp = () => {
  const { t } = useLingui();

  const entries = useMemo<ShortcutHelpEntry[]>(() => {
    const general = t`General`;
    const navigation = t`Navigation`;
    const assembly = t`Assembly steps`;

    return [
      {
        shortcut: START_STOP_SHORTCUT,
        description: t`Start or pause the operation`,
        group: general
      },
      {
        shortcut: SHORTCUTS.save,
        description: t`Save the form you're editing`,
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
        shortcut: MES_NAV_SHORTCUTS.operations,
        description: t`Schedule`,
        group: navigation
      },
      {
        shortcut: MES_NAV_SHORTCUTS.assigned,
        description: t`Assigned`,
        group: navigation
      },
      {
        shortcut: MES_NAV_SHORTCUTS.active,
        description: t`Active`,
        group: navigation
      },
      {
        shortcut: MES_NAV_SHORTCUTS.recent,
        description: t`Recent`,
        group: navigation
      },
      {
        shortcut: MES_NAV_SHORTCUTS.jobs,
        description: t`Jobs`,
        group: navigation
      },
      {
        shortcut: MES_NAV_SHORTCUTS.maintenance,
        description: t`Maintenance`,
        group: navigation
      },
      {
        shortcut: MES_NAV_SHORTCUTS.picking,
        description: t`Picking`,
        group: navigation
      },
      // AssemblyView owns these bindings (apps/mes/app/components/AssemblyView.tsx);
      // they are listed here for discoverability.
      {
        shortcut: "enter",
        description: t`Mark the step done / record`,
        group: assembly
      },
      {
        shortcut: "arrowright",
        description: t`Next step`,
        group: assembly
      },
      {
        shortcut: "arrowleft",
        description: t`Previous step`,
        group: assembly
      }
    ];
  }, [t]);

  return (
    <ShortcutHelpOverlay
      title={t`Keyboard shortcuts`}
      entries={entries}
      emptyLabel={t`No shortcuts available on this page.`}
    />
  );
};

export default ShortcutHelp;
