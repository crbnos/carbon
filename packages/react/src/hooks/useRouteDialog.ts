// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { NavigateOptions, To } from "react-router";
import {
  UNSAFE_DataRouterContext,
  useLocation,
  useNavigate
} from "react-router";
import {
  hasUnsavedChanges,
  openModalDialogs,
  whenDialogsRemoved
} from "../utils/dialog";
import { useCloseRoute } from "./useCloseRoute";

// How often, after leaving, the route is checked again; and how long a leave
// may show no sign of moving (a late `popstate`) before a blocker with no
// prompt is assumed to have kept the page.
const STAYED_CHECK_MS = 300;
const SILENT_BLOCK_MS = 2000;

type Left = {
  attempt: number;
  locationKey: string;
  before: Set<Element>;
  // Leaves in a row that landed back on this route (search params pushed
  // inside the dialog). Bounded, so a parent that resolves to this route
  // again cannot loop.
  steps: number;
};

const MAX_STEPS_BACK = 20;

/**
 * Open state for a route that renders as a modal or drawer over its parent.
 *
 * Navigating away removes the route, and its dialog, in the same render, so
 * the dialog never played its closing animation. `close` sets `open` to false
 * first; the route is left only when the dialog is off the page. With no `to`
 * it leaves as `useCloseRoute` does: back, else to the parent route.
 *
 * ```tsx
 * const dialog = useRouteDialog();
 * return <GaugeForm open={dialog.open} onClose={dialog.close} />;
 * ```
 */
export function useRouteDialog(to?: To, options?: NavigateOptions) {
  const navigate = useNavigate();
  const closeRoute = useCloseRoute();
  const location = useLocation();
  // Navigation state is read on demand, not subscribed to: a route dialog
  // must not re-render its whole form on every navigation and fetcher
  // transition on the page.
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const router = dataRouter?.router;
  const [open, setOpen] = useState(true);
  // Dialogs open before this route mounted belong to what is behind it (a
  // parent route's drawer); any other open dialog is this route's own.
  const [behind] = useState(
    () => new Set(typeof document === "undefined" ? [] : openModalDialogs())
  );

  // Each close is one attempt; reopening ends it, so its late steps do nothing.
  const attempt = useRef(0);
  const closing = useRef<{
    attempt: number;
    dialogs: Element[];
    waiting: boolean;
    // A navigation moved the location while the dialog closed; if the route
    // is still here once React commits it, the dialog shows again.
    moved: boolean;
  } | null>(null);
  const left = useRef<Left | null>(null);
  const mounted = useRef(false);
  // Aborted on unmount: ends any wait this route started on the page's DOM.
  const unmounted = useRef<AbortController | null>(null);
  const latest = useRef({ to, options, location });
  latest.current = { to, options, location };

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    unmounted.current = controller;
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);

  // The router's location is ahead of React's while a navigation commits.
  const locationKey = useCallback(
    () => router?.state.location.key ?? latest.current.location.key,
    [router]
  );
  const navigationIdle = useCallback(
    () => (router?.state.navigation.state ?? "idle") === "idle",
    [router]
  );

  // Calls `then` once no navigation is loading and the location is the
  // same: at once, or when the one under way settles without moving. A
  // navigation that moved the location has left (or re-entered) the route
  // itself, and the router reports it before React has committed it, so
  // `onMoved` runs instead. Unmounting stops the wait.
  const whenNavigationIdle = useCallback(
    (then: () => void, onMoved?: () => void) => {
      const signal = unmounted.current?.signal;
      if (!router || navigationIdle()) {
        then();
        return;
      }
      if (signal?.aborted) return;
      const from = router.state.location.key;
      const stop = () => unsubscribe();
      const unsubscribe = router.subscribe((state) => {
        if (state.navigation.state !== "idle") return;
        unsubscribe();
        signal?.removeEventListener("abort", stop);
        if (state.location.key === from) then();
        else onMoved?.();
      });
      signal?.addEventListener("abort", stop, { once: true });
    },
    [router, navigationIdle]
  );

  // After a leave: still on this route, nothing loading, and no prompt (a
  // dialog that was not open before leaving) on the page. The user stayed.
  const stayed = useCallback(
    (state: Left) =>
      mounted.current &&
      locationKey() === state.locationKey &&
      navigationIdle() &&
      openModalDialogs().every((dialog) => state.before.has(dialog)),
    [locationKey, navigationIdle]
  );

  const reopen = useCallback(() => {
    attempt.current += 1;
    closing.current = null;
    left.current = null;
    setOpen(true);
  }, []);

  const leave = useCallback(
    (current: number, steps = 0) => {
      const { to, options } = latest.current;
      const state: Left = {
        attempt: current,
        locationKey: locationKey(),
        before: new Set(openModalDialogs()),
        steps
      };
      left.current = state;
      if (closing.current) closing.current.moved = false;
      if (to === undefined) closeRoute();
      else navigate(to, options);

      // A blocker kept the page: show the dialog again once its prompt is
      // answered with "stay" — not while the prompt is open, where it would
      // cover the prompt and trap its focus.
      const startedAt = performance.now();
      // Whether a blocker fired for this leave, even if the user has already
      // answered: a fast "stay" must not wait out the silence below.
      const isBlocked = () =>
        Array.from(router?.state.blockers.values() ?? []).some(
          (blocker) => blocker.state === "blocked"
        );
      let sawBlock = isBlocked();
      const signal = unmounted.current?.signal;
      const unsubscribe = router?.subscribe(() => {
        if (isBlocked()) sawBlock = true;
      });
      const unwatch = () => {
        unsubscribe?.();
        signal?.removeEventListener("abort", unwatch);
      };
      signal?.addEventListener("abort", unwatch, { once: true });
      const check = () => {
        if (!mounted.current || left.current !== state) {
          unwatch();
          return;
        }
        if (locationKey() !== state.locationKey) {
          unwatch();
          return;
        }
        if (!navigationIdle()) {
          // Moved: the leave went through, so stop watching.
          whenNavigationIdle(check, () => unwatch());
          return;
        }
        // Nothing blocked and nothing moved yet: a back navigation can wait
        // for its `popstate`. Look again; only a long silence means a blocker
        // with no prompt kept the page.
        if (!sawBlock && performance.now() - startedAt < SILENT_BLOCK_MS) {
          setTimeout(check, STAYED_CHECK_MS);
          return;
        }
        unwatch();
        const prompts = openModalDialogs().filter(
          (dialog) => !state.before.has(dialog)
        );
        whenDialogsRemoved(
          prompts,
          Number.POSITIVE_INFINITY,
          unmounted.current?.signal
        ).then(() => {
          if (left.current === state && stayed(state)) reopen();
        });
      };
      setTimeout(check, STAYED_CHECK_MS);
    },
    [
      closeRoute,
      navigate,
      locationKey,
      navigationIdle,
      reopen,
      router,
      stayed,
      whenNavigationIdle
    ]
  );

  // The navigation landed on an earlier entry of this same route (back over
  // search params the dialog pushed): this effect runs after the commit, so
  // the route is still here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new location
  useEffect(() => {
    // Closed while another navigation (a save's redirect, a pushed search
    // param) moved the location, and the route is still here: that
    // navigation wins, so show the dialog again instead of leaving over it.
    const pending = closing.current;
    if (pending?.moved && !left.current) {
      reopen();
      return;
    }
    const state = left.current;
    if (!state || location.key === state.locationKey) return;
    // Going back: keep going back until the route is left, also with
    // unsaved changes, whose blocker asks once the pathname changes.
    // Only after a back navigation (POP): a push to the parent that still
    // shows this route would bounce between the two entries.
    if (
      latest.current.to === undefined &&
      router?.state.historyAction === "POP" &&
      state.steps < MAX_STEPS_BACK
    ) {
      leave(state.attempt, state.steps + 1);
    } else {
      reopen();
    }
  }, [location.key]);

  // React has committed `open = false`: the dialogs it set to "closed" or
  // took off the page are this route's own. Leave once they are gone.
  useEffect(() => {
    const pending = closing.current;
    if (open || !pending || pending.waiting) return;
    pending.waiting = true;
    const closed = pending.dialogs.filter(
      (dialog) =>
        !dialog.isConnected || dialog.getAttribute("data-state") !== "open"
    );
    // A navigation already under way (a save's redirect) leaves the route
    // itself; navigating now would override it. Leave only once it settles
    // with the route still here.
    whenDialogsRemoved(closed).then(() =>
      whenNavigationIdle(
        () => {
          if (mounted.current && attempt.current === pending.attempt) {
            leave(pending.attempt);
          }
        },
        () => {
          pending.moved = true;
        }
      )
    );
  }, [open, leave, whenNavigationIdle]);

  const close = useCallback(() => {
    if (closing.current) return;
    if (left.current) {
      // Asked about unsaved changes a moment ago: close again only once the
      // user has answered "stay".
      if (!stayed(left.current)) return;
      left.current = null;
    }
    const dialogs = openModalDialogs();
    attempt.current += 1;
    // A form in this route's dialog has unsaved changes: leave now, so its
    // Submit's blocker asks while the dialog is still open. Closing first
    // would unmount that blocker and lose the edits without a prompt.
    const own = dialogs.filter((dialog) => !behind.has(dialog));
    if (own.some((dialog) => hasUnsavedChanges(dialog))) {
      leave(attempt.current);
      return;
    }
    closing.current = {
      attempt: attempt.current,
      dialogs,
      waiting: false,
      moved: false
    };
    setOpen(false);
  }, [behind, leave, stayed]);

  return { open, close };
}
