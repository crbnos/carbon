// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { Muted, Screen } from "~/components/ui";
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

  if (state === "loading") {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator />
          <Muted>
            <Trans>Carbon MES</Trans>
          </Muted>
        </View>
      </Screen>
    );
  }

  if (state === "no_instance") return <Redirect href="/(setup)/connect" />;
  if (state === "ready") return <Redirect href="/(app)/(tabs)/operations" />;
  if (state === "mfa_required") return <Redirect href="/(auth)/two-factor" />;
  if (state === "code_sent") return <Redirect href="/(auth)/verify" />;
  if (state === "needs_password") return <Redirect href="/(auth)/password" />;
  return <Redirect href="/(auth)/sign-in" />;
}
