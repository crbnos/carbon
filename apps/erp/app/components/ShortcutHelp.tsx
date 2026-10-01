// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
    const listPages = t`List pages`;
    const itemPages = t`Item pages`;
    const partnerPages = t`Customer and supplier pages`;
    const inventoryPages = t`Inventory pages`;
    const documentLines = t`Quotes, orders, invoices and RFQs`;
    const procedures = t`Procedures and training`;
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
        shortcut: SHORTCUTS.sidebarToggle,
        description: t`Toggle the sidebar`,
        group: general
      },
      {
        shortcut: SHORTCUTS.help,
        description: t`Show keyboard shortcuts`,
        group: general
      },
      {
        shortcut: SHORTCUTS.newRecord,
        description: t`New record`,
        group: listPages
      },
      {
        shortcut: PAGINATION_SHORTCUTS.previous,
        description: t`Previous page`,
        group: listPages
      },
      {
        shortcut: PAGINATION_SHORTCUTS.next,
        description: t`Next page`,
        group: listPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.details,
        description: t`Details`,
        group: itemPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.purchasing,
        description: t`Purchasing`,
        group: itemPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.planning,
        description: t`Planning`,
        group: itemPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.inventory,
        description: t`Inventory`,
        group: itemPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.sales,
        description: t`Sales`,
        group: itemPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.quality,
        description: t`Quality`,
        group: itemPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.accounting,
        description: t`Accounting`,
        group: itemPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.details,
        description: t`Details`,
        group: partnerPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.contacts,
        description: t`Contacts`,
        group: partnerPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.locations,
        description: t`Locations`,
        group: partnerPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.payment,
        description: t`Payment`,
        group: partnerPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.tax,
        description: t`Tax`,
        group: partnerPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.shipping,
        description: t`Shipping`,
        group: partnerPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.processes,
        description: t`Processes (suppliers only)`,
        group: partnerPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.details,
        description: t`Details`,
        group: inventoryPages
      },
      {
        shortcut: DETAIL_TAB_SHORTCUTS.activity,
        description: t`Activity`,
        group: inventoryPages
      },
      {
        shortcut: EXPLORER_SHORTCUTS.addLine,
        description: t`Add a line to the document`,
        group: documentLines
      },
      {
        shortcut: EXPLORER_SHORTCUTS.addAttribute,
        description: t`Add a step or question`,
        group: procedures
      },
      {
        shortcut: EXPLORER_SHORTCUTS.addParameter,
        description: t`Add a parameter (procedures only)`,
        group: procedures
      },
      ...moduleEntries
    ];
  }, [t, modules, settingsModule]);

  return (
    <ShortcutHelpOverlay
      title={t`Keyboard shortcuts`}
      description={t`Press ? on any page to open this list. Shortcuts are ignored while you type in a field.`}
      entries={entries}
      emptyLabel={t`No shortcuts available on this page.`}
    />
  );
};

export default ShortcutHelp;
