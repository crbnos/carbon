// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "~/lib/auth/AuthProvider";
import { idleAction, isIdle } from "./policy";

/**
 * Pins an operator out, or signs a controlled device out, after
 * `me.instance.idleLockMs` of inactivity.
 *
 * The clock is checked on a timer rather than scheduled once, because a
 * `setTimeout` does not fire reliably while an app is backgrounded — and a
 * tablet in a pocket or asleep on a bench is exactly the case this exists for.
 * Returning to the foreground re-checks immediately, so a device that was
 * asleep past the limit locks on the way back in rather than a tick later.
 *
 * `touch()` is what the app calls on real interaction. Nothing calls it
 * automatically: a poll refetching in the background is not an operator being
 * present, and treating it as one would keep a walked-away tablet unlocked
 * forever.
 */
const CHECK_INTERVAL_MS = 15_000;

export function useIdleLock() {
  const { me, operatorToken, setOperatorToken, signOut } = useAuth();
  const lastActivity = useRef(Date.now());

  const idleLockMs = me?.instance.idleLockMs ?? 0;
  const controlledEnvironment = me?.instance.controlledEnvironment ?? false;
  const hasOperator = Boolean(operatorToken);

  const action = idleAction({ idleLockMs, controlledEnvironment, hasOperator });

  useEffect(() => {
    if (action === "none") return;

    const check = () => {
      if (
        !isIdle({
          lastActivityMs: lastActivity.current,
          nowMs: Date.now(),
          idleLockMs
        })
      ) {
        return;
      }
      // Reset first: whichever action runs, the device is no longer idle, and
      // a second fire while the first is still settling would sign out a
      // terminal that only needed pinning out.
      lastActivity.current = Date.now();
      if (action === "pin_out") setOperatorToken(null);
      else void signOut();
    };

    const timer = setInterval(check, CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [action, idleLockMs, setOperatorToken, signOut]);

  return {
    /** Call on real operator interaction. */
    touch: () => {
      lastActivity.current = Date.now();
    },
    /** Whether an idle policy is in force, for the More screen to report. */
    active: action !== "none",
    action
  };
}
