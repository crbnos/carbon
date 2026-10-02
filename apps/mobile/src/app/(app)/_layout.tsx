// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { Screen } from "~/components/ui";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The guard for everything behind sign-in. A company and a location must be
 * chosen before any screen renders: every query key and every API call is
 * scoped by them, and a screen that rendered without them would either query
 * nothing or query the wrong tenant.
 */
export default function AppLayout() {
  const { state, companyId, locationId } = useAuth();

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
  if (!companyId || !locationId) return <Redirect href="/(app)/context" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
