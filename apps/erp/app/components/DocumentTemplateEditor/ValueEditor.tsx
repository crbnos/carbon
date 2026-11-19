// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { allMergeFields, setValueEdit } from "@carbon/documents/template";
import {
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Textarea
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuRotateCcw } from "react-icons/lu";
import { useDocumentTemplate } from "./context";
import { useMergeFieldName } from "./mergeFieldNames";
import type { ValueTarget } from "./valueTargets";

/**
 * The small editor a chip's pencil opens: the value this document prints. A
 * value printed per table row lists each row, since one chip stands for them all.
 */
export function ValueEditor({
  token,
  chip,
  targets,
  onClose
}: {
  token: string;
  chip: HTMLElement;
  /** Every place this document prints the value: one, or one per row. */
  targets: ValueTarget[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fieldName = useMergeFieldName();
  const { documentType, settings, setSetting } = useDocumentTemplate();

  const field = useMemo(
    () => allMergeFields(documentType).find((f) => f.token === token),
    [documentType, token]
  );
  const name = fieldName(field?.label ?? token);
  // The box the chip sits in: the editor lines up with its right edge.
  const anchor = useMemo(
    () => ({ current: chip.closest<HTMLElement>('[role="textbox"]') ?? chip }),
    [chip]
  );
  const isPerRow = targets.length > 1;

  const change = (target: ValueTarget, text: string) =>
    setSetting("valueEdits", setValueEdit(settings.valueEdits, target, text));

  const resetButton = (target: ValueTarget) =>
    target.printedValue !== target.recordValue ? (
      <IconButton
        aria-label={t`Use the record's value`}
        variant="ghost"
        size="sm"
        icon={<LuRotateCcw />}
        className="-mr-1 size-6 shrink-0"
        onClick={() => change(target, target.recordValue)}
      />
    ) : null;

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        // Only an anchor, so Radix has no trigger to give the focus back to.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          chip.focus();
        }}
        side="bottom"
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="flex w-[var(--radix-popper-anchor-width)] min-w-60 flex-col gap-1.5 p-2.5"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="flex h-6 items-center justify-between gap-2">
          <span className="truncate text-xs font-medium">{name}</span>
          {!isPerRow && targets[0] && resetButton(targets[0])}
        </div>
        <div className="flex max-h-72 flex-col gap-2 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          {targets.map((target, index) => {
            const group = fieldName(field?.group ?? "");
            const number = index + 1;
            const rowName = isPerRow ? t`${group} ${number}` : null;
            return (
              <div key={target.rowKey ?? token} className="flex flex-col gap-1">
                {rowName && (
                  <div className="flex h-6 items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {rowName}
                    </span>
                    {resetButton(target)}
                  </div>
                )}
                <Textarea
                  aria-label={rowName ? t`${name}, ${rowName}` : name}
                  autoFocus={index === 0}
                  rows={target.printedValue.split("\n").length}
                  className="field-sizing-content"
                  value={target.printedValue}
                  onChange={(e) => change(target, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
