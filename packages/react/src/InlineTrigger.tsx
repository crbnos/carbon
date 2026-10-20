// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef } from "react";
import { cn } from "./utils/cn";

/** The classes of an inline field's trigger, for a trigger that is not this button. */
export const inlineTriggerClassName = cn(
  "-ml-2.5 flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-full px-2.5 py-1 text-left text-sm transition-colors",
  "hover:bg-accent data-[state=open]:bg-accent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:cursor-default disabled:hover:bg-transparent"
);

/**
 * The classes of the input that replaces the trigger while the field is edited:
 * the trigger's height and gutter, with the padding less the 1px border, so the
 * text stays where it was and nothing below it moves.
 */
export const inlineEditorClassName =
  "-ml-2.5 h-8 max-md:h-8 w-[calc(100%+0.625rem)] px-[9px]";

export type InlineTriggerProps = ComponentPropsWithoutRef<"button"> & {
  /** Shown in place of the value, muted: "Add owner". */
  placeholder?: ReactNode;
  isEmpty?: boolean;
  isDisabled?: boolean;
};

/**
 * An inline field's value as the button that edits it, as Linear's properties
 * do: the value itself, or "Add …" while it is empty. The hover background
 * reaches into the left gutter so the text lines up with the label above it.
 * Place it in a flex row.
 */
export const InlineTrigger = forwardRef<HTMLButtonElement, InlineTriggerProps>(
  (
    { placeholder, isEmpty, isDisabled, className, children, ...props },
    ref
  ) => (
    <button
      ref={ref}
      type="button"
      disabled={isDisabled}
      {...props}
      className={cn(inlineTriggerClassName, className)}
    >
      {isEmpty ? (
        <span className="truncate text-muted-foreground">{placeholder}</span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center overflow-hidden">
          {children}
        </span>
      )}
    </button>
  )
);
InlineTrigger.displayName = "InlineTrigger";
