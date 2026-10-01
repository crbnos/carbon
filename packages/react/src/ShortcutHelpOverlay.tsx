// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Fragment, useMemo, useState } from "react";
import type { ShortcutInput } from "./hooks/useShortcutKeys";
import { useShortcutKeyMap } from "./hooks/useShortcutKeys";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "./Modal";
import { ShortcutKey } from "./ShortcutKey";
import { Subheading } from "./Subheading";
import { SHORTCUTS } from "./shortcuts";
import { cn } from "./utils/cn";

export type ShortcutHelpEntry = {
  /** Rendered as keycaps. A `string[]` means a sequence ("g" then "s"). */
  shortcut: ShortcutInput | string[];
  /** Translated by the app. */
  description: string;
  /** Translated section heading; groups render in first-seen order. */
  group: string;
};

type ShortcutHelpOverlayProps = {
  title: string;
  /** One line under the title: how to open the list, when shortcuts pause. */
  description?: string;
  entries: ShortcutHelpEntry[];
  emptyLabel: string;
};

/**
 * Keycap(s) for one help entry — sequences render as chained keycaps joined
 * by "then", so the apps only declare data, never row markup.
 */
export function ShortcutHelpKeys({
  shortcut,
  className
}: {
  shortcut: ShortcutInput | string[];
  className?: string;
}) {
  const { t } = useLingui();
  if (Array.isArray(shortcut)) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        {shortcut.map((part, index) => (
          <Fragment key={`${part}-${index}`}>
            {index > 0 && (
              <span className="text-xs text-muted-foreground">{t`then`}</span>
            )}
            <ShortcutKey shortcut={part} variant="help" />
          </Fragment>
        ))}
      </span>
    );
  }
  return (
    <ShortcutKey shortcut={shortcut} variant="help" className={className} />
  );
}

/**
 * The `?` shortcut help overlay. Entries are declared by the app from its
 * central shortcut definition files — there is deliberately no runtime
 * registry. Inert while any dialog is open or while typing (map semantics).
 */
export function ShortcutHelpOverlay({
  title,
  description,
  entries,
  emptyLabel
}: ShortcutHelpOverlayProps) {
  const [open, setOpen] = useState(false);

  useShortcutKeyMap(
    useMemo(
      () => [{ shortcut: SHORTCUTS.help, action: () => setOpen(true) }],
      []
    )
  );

  const groups = useMemo(() => {
    const byGroup = new Map<string, ShortcutHelpEntry[]>();
    for (const entry of entries) {
      const list = byGroup.get(entry.group) ?? [];
      list.push(entry);
      byGroup.set(entry.group, list);
    }
    return [...byGroup.entries()];
  }, [entries]);

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalOverlay />
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          {description && <ModalDescription>{description}</ModalDescription>}
        </ModalHeader>
        <ModalBody>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <div className="gap-x-10 sm:columns-2">
              {groups.map(([group, groupEntries]) => (
                <section
                  key={group}
                  className="mb-6 break-inside-avoid last:mb-0"
                >
                  <Subheading as="h3" className="mb-1 block">
                    {group}
                  </Subheading>
                  <ul className="divide-y divide-border/60">
                    {groupEntries.map((entry, index) => (
                      <li
                        key={`${entry.description}-${index}`}
                        className="flex items-center justify-between gap-6 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 text-pretty text-foreground">
                          {entry.description}
                        </span>
                        <ShortcutHelpKeys
                          shortcut={entry.shortcut}
                          className="shrink-0"
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
