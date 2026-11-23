// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * How a record action renders on phones, set by the ERP's RecordAction:
 * - `bar`: a cell of the bottom action bar, filled (`primary`) or outline
 *   (`secondary`) whatever variant the caller passed; `iconOnly` makes it a
 *   square icon cell (Preview).
 * - `row`: a row of the ⋯ action sheet; choosing it calls `onSelect` (closes
 *   the sheet).
 * Desktop and everything outside a RecordAction see `null`.
 */
export type ActionPresentation =
  | {
      kind: "bar";
      emphasis: "primary" | "secondary";
      /** A square cell: the left icon only, the label for screen readers. */
      iconOnly?: boolean;
      /**
       * Renders buttons as rows of the record's ⋯ menu. A bar cell holds one
       * action, so a split button sends its dropdown items here.
       */
      overflow?: (buttons: ReactNode) => ReactNode;
    }
  | { kind: "row"; onSelect: () => void };

const Context = createContext<ActionPresentation | null>(null);

export const ActionPresentationProvider = Context.Provider;

export function useActionPresentation() {
  return useContext(Context);
}

/**
 * Popup contents start a new scope: a dialog an action opens renders its own
 * buttons normally, not as bar cells or sheet rows. (Context crosses portals;
 * the dialog is still a React child of the action.)
 */
export function ActionPresentationBoundary({
  children
}: {
  children: ReactNode;
}) {
  return <Context.Provider value={null}>{children}</Context.Provider>;
}
