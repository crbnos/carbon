// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import { Heading, Muted, Screen, WarningNote } from "~/components/ui";

/**
 * Not built yet. This screen is a deliberate, honest placeholder rather than a
 * shell that looks interactive: an operator must never be left tapping
 * something that cannot work. Web MES does all of this today.
 */
export default function Scan() {
  const { t } = useLingui();
  return (
    <Screen className="gap-4 py-4">
      <Heading>
        <Trans>Scan</Trans>
      </Heading>
      <View className="gap-3">
        <Muted>{t`Scanning a traveller to open an operation, and scanning a part to issue it, arrive with the operation screen.`}</Muted>
        <WarningNote>
          {t`For now, use Carbon MES in a browser for this.`}
        </WarningNote>
      </View>
    </Screen>
  );
}
