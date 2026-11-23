// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createContext, useContext, useEffect } from "react";

/**
 * What a route knows about the dialog it renders. `RecordOutlet` provides one
 * per outlet, so `useRouteDialog` (above the dialog) and the dialog and its
 * `Submit` (below it) can reach each other without a prop through every form.
 */
export type RouteDialogScope = {
  /** Top-level dialogs on the page in this outlet. */
  dialogs: number;
  /** Forms in this outlet with unsaved changes. */
  unsaved: number;
  onDialogExit: (() => void) | null;
};

export const createRouteDialogScope = (): RouteDialogScope => ({
  dialogs: 0,
  unsaved: 0,
  onDialogExit: null
});

export const RouteDialogScopeContext = createContext<RouteDialogScope | null>(
  null
);

/** How many dialogs enclose this point; `RecordOutlet` starts it again at 0. */
export const DialogDepthContext = createContext(0);

/**
 * Rendered inside the content of a Modal or Drawer. Radix unmounts the content
 * after its closing animation, so this effect's cleanup is the moment the
 * dialog has left the page. A dialog nested in another does not count.
 */
export function ReportDialogExit() {
  const scope = useContext(RouteDialogScopeContext);
  const isTopLevel = useContext(DialogDepthContext) === 1;
  useEffect(() => {
    if (!scope || !isTopLevel) return;
    scope.dialogs += 1;
    return () => {
      scope.dialogs -= 1;
      scope.onDialogExit?.();
    };
  }, [scope, isTopLevel]);
  return null;
}

export function useReportUnsavedChanges(unsaved: boolean) {
  const scope = useContext(RouteDialogScopeContext);
  useEffect(() => {
    if (!scope || !unsaved) return;
    scope.unsaved += 1;
    return () => {
      scope.unsaved -= 1;
    };
  }, [scope, unsaved]);
}
