// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import { LabelWithHelp } from "@carbon/react";
import type { ReactNode } from "react";

type ReadOnlyFieldProps = {
  label: ReactNode;
  termId?: TermId;
  children?: ReactNode;
};

/**
 * A value the user reads but does not edit, shown as text: a muted label over
 * the value. No input box, no border and no disabled styling — a locked or
 * computed value must not look like a broken form field.
 */
export function ReadOnlyField({ label, termId, children }: ReadOnlyFieldProps) {
  const isEmpty =
    children === null || children === undefined || children === "";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {termId ? (
          <LabelWithHelp termId={termId} variant="inline">
            {label}
          </LabelWithHelp>
        ) : (
          label
        )}
      </span>
      <div className="min-w-0 text-sm text-foreground">
        {isEmpty ? <span className="text-muted-foreground">—</span> : children}
      </div>
    </div>
  );
}

/** Lays `ReadOnlyField`s out in 1, 2 or 3 columns by the width of their pane. */
export function ReadOnlyFields({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
        {children}
      </div>
    </div>
  );
}
