// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Redirect, Stack, useSegments } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { Screen } from "~/components/ui";
import { AnalyticsProvider } from "~/lib/analytics/AnalyticsProvider";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useIdleLock } from "~/lib/idle/useIdleLock";

/**
 * The guard for everything behind sign-in. A company and a location must be
 * chosen before any screen renders: every query key and every API call is
 * scoped by them, and a screen that rendered without them would either query
 * nothing or query the wrong tenant.
 */
export default function AppLayout() {
  const { state, companyId, locationId } = useAuth();
  const segments = useSegments();

  if (state === "loading") {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (state === "no_instance") return <Redirect href="/(setup)/connect" />;
  if (state !== "ready") return <Redirect href="/" />;
  // The picker is a child of THIS layout, so the redirect must not fire while
  // it is already the current screen: returning <Redirect> here means the
  // Stack below never renders, and a redirect to a route this layout refuses
  // to render is a loop — the picker never appears and the screen that
  // navigated here sits under its spinner forever. That was invisible while
  // every account was force-assigned its first company at sign-in; an account
  // in several companies now arrives here with none.
  const onPicker = segments[segments.length - 1] === "context";
  if ((!companyId || !locationId) && !onPicker) {
    return <Redirect href="/(app)/context" />;
  }

  return (
    <AnalyticsProvider>
      <IdleGuard />
      <Stack screenOptions={{ headerShown: false }} />
    </AnalyticsProvider>
  );
}

/**
 * The idle-lock timer, mounted once for the whole signed-in area.
 *
 * A component rather than a hook call in `AppLayout` because it renders
 * nothing and must not re-render the Stack: a `setOperatorToken` from inside
 * the timer would otherwise remount every screen under it.
 */
function IdleGuard() {
  useIdleLock();
  return null;
}
