// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Redirect } from "expo-router";
import { LaunchScreen } from "~/components/LaunchScreen";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The only decision this screen makes: which of the three worlds the app is in.
 *
 *   no instance linked  → (setup)/connect
 *   linked, not signed in → (auth)/sign-in
 *   signed in            → (app)
 */
export default function Index() {
  const { state } = useAuth();

  // A branded fade rather than a spinner. This is the normal path on every
  // launch, and a spinner reads as "something may be wrong".
  if (state === "loading") return <LaunchScreen />;

  if (state === "no_instance") return <Redirect href="/(setup)/connect" />;
  if (state === "ready") return <Redirect href="/(app)/(tabs)/operations" />;
  if (state === "mfa_required") return <Redirect href="/(auth)/two-factor" />;
  if (state === "code_sent") return <Redirect href="/(auth)/verify" />;
  if (state === "needs_password") return <Redirect href="/(auth)/password" />;
  return <Redirect href="/(auth)/sign-in" />;
}
