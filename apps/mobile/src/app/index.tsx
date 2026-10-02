// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { Text, View } from "react-native";

/**
 * Phase 0 placeholder. Phase 1 replaces this with the instance/session guard
 * that routes to (setup)/connect, (auth)/sign-in or (app).
 */
export default function Index() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-background px-4">
      <Text className="text-2xl font-semibold text-foreground">
        <Trans>Carbon MES</Trans>
      </Text>
      <Text className="text-base text-muted-foreground">
        <Trans>Shop floor execution</Trans>
      </Text>
    </View>
  );
}
