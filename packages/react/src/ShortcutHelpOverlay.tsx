import { Fragment, useMemo, useState } from "react";
import type { ShortcutInput } from "./hooks/useShortcutKeys";
import { useShortcutKeyMap } from "./hooks/useShortcutKeys";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "./Modal";
import { ShortcutKey } from "./ShortcutKey";
import { SHORTCUTS } from "./shortcuts";

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
  entries: ShortcutHelpEntry[];
  emptyLabel: string;
};

/**
 * Keycap(s) for one help entry — sequences render as chained keycaps with a
 * visual separator, so the apps only declare data, never row markup.
 */
export function ShortcutHelpKeys({
  shortcut
}: {
  shortcut: ShortcutInput | string[];
}) {
  if (Array.isArray(shortcut)) {
    return (
      <span className="inline-flex items-center gap-1">
        {shortcut.map((part, index) => (
          <Fragment key={`${part}-${index}`}>
            {index > 0 && (
              <span aria-hidden className="text-xs text-muted-foreground">
                →
              </span>
            )}
            <ShortcutKey shortcut={part} variant="small" />
          </Fragment>
        ))}
      </span>
    );
  }
  return <ShortcutKey shortcut={shortcut} variant="small" />;
}

/**
 * The `?` shortcut help overlay. Entries are declared by the app from its
 * central shortcut definition files — there is deliberately no runtime
 * registry. Inert while any dialog is open or while typing (map semantics).
 */
export function ShortcutHelpOverlay({
  title,
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
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(([group, groupEntries]) => (
                <div key={group}>
                  <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                    {group}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {groupEntries.map((entry, index) => (
                      <li
                        key={`${entry.description}-${index}`}
                        className="flex items-center justify-between gap-4 text-sm"
                      >
                        <span>{entry.description}</span>
                        <ShortcutHelpKeys shortcut={entry.shortcut} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
