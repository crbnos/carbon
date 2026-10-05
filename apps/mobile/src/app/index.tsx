// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { LAUNCH_HOLD_MS, LaunchScreen } from "~/components/LaunchScreen";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The only decision this screen makes: which of the three worlds the app is in.
 *
 *   no instance linked  → (setup)/connect
 *   linked, not signed in → (auth)/sign-in
 *   signed in            → (app)
 */

/**
 * Whether the launch animation has had time to play.
 *
 * `state` resolves from a SecureStore read, which on a warm device takes a
 * few milliseconds — far less than the animation. Measured on a cold start,
 * the app went white splash straight to Sign in and the launch screen never
 * visibly rendered. So the redirect waits for the LATER of the two: the
 * decision being made, and the animation finishing.
 *
 * The timer starts on mount rather than when `state` settles, so a slow
 * decision costs nothing extra — by the time it arrives the animation has
 * usually already run, and the app moves on immediately.
 */
function useLaunchHeld() {
  const [held, setHeld] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setHeld(false), LAUNCH_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);
  return held;
}

export default function Index() {
  const { state } = useAuth();
  const held = useLaunchHeld();

  // A branded entrance rather than a spinner. This is the normal path on
  // every launch, and a spinner reads as "something may be wrong".
  if (state === "loading" || held) return <LaunchScreen />;

  if (state === "no_instance") return <Redirect href="/(setup)/connect" />;
  if (state === "ready") return <Redirect href="/(app)/(tabs)/operations" />;
  if (state === "mfa_required") return <Redirect href="/(auth)/two-factor" />;
  if (state === "code_sent") return <Redirect href="/(auth)/verify" />;
  if (state === "needs_password") return <Redirect href="/(auth)/password" />;
  return <Redirect href="/(auth)/sign-in" />;
}
