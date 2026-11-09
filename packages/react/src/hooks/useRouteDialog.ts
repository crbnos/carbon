// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useContext, useEffect, useRef, useState } from "react";
import type { NavigateOptions, To } from "react-router";
import { useLocation, useNavigate, useNavigation } from "react-router";
import { RouteDialogScopeContext } from "../RouteDialogScope";
import useCallbackRef from "./useCallbackRef";
import { useCloseRoute } from "./useCloseRoute";
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect";

/**
 * Open state for a route that renders as a modal or drawer over its parent.
 *
 * Navigating away removes the route, and its dialog, in the same render, so
 * the dialog could not play its closing animation. `close` sets `open` to
 * false first; the route is left when the dialog has gone. With no `to` it
 * leaves as `useCloseRoute` does: back, else to the parent route.
 *
 * ```tsx
 * const dialog = useRouteDialog();
 * return <GaugeForm open={dialog.open} onClose={dialog.close} />;
 * ```
 */
export function useRouteDialog(to?: To, options?: NavigateOptions) {
  const closeRoute = useCloseRoute();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const location = useLocation();
  const scope = useContext(RouteDialogScopeContext);
  const [open, setOpen] = useState(true);
  const phase = useRef<"open" | "closing" | "exited" | "left">("open");

  // Set in a layout effect's cleanup, which runs before the passive cleanup
  // that reports a dialog's exit: a route torn down by a redirect is not a
  // dialog that finished closing.
  const mounted = useRef(true);
  useIsomorphicLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const navigateAway = useCallbackRef(() => {
    if (to === undefined) closeRoute();
    else navigate(to, options);
  });

  // A navigation already under way (a save's redirect) leaves by itself.
  const leaveOnceSettled = useCallbackRef(() => {
    if (phase.current !== "exited" || navigation.state !== "idle") return;
    phase.current = "left";
    navigateAway();
  });

  useEffect(() => {
    if (!scope) return;
    scope.onDialogExit = () => {
      if (!mounted.current || phase.current !== "closing") return;
      phase.current = "exited";
      leaveOnceSettled();
    };
    return () => {
      scope.onDialogExit = null;
    };
  }, [scope, leaveOnceSettled]);

  // The location moved and this route is still here (back to an earlier entry
  // of it, a pushed search param): its dialog shows again, as it did when
  // closing only navigated.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new location
  useEffect(() => {
    if (phase.current === "open") return;
    phase.current = "open";
    setOpen(true);
  }, [location.key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a navigation settles
  useEffect(() => {
    leaveOnceSettled();
  }, [navigation.state]);

  const close = useCallbackRef(() => {
    if (phase.current !== "open") return;
    // No dialog to wait for, or unsaved changes: navigate now, so a Submit's
    // blocker asks while the dialog is still open. Closing first would unmount
    // that blocker and lose the edits without a prompt.
    if (!scope || scope.dialogs === 0 || scope.unsaved > 0) {
      navigateAway();
      return;
    }
    phase.current = "closing";
    setOpen(false);
  });

  return { open, close };
}
