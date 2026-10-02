// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Alert, ScrollView, View } from "react-native";
import {
  Body,
  Button,
  Card,
  Heading,
  Muted,
  Screen,
  WarningNote
} from "~/components/ui";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useInstances } from "~/lib/instances/InstanceProvider";
import { instanceLabel } from "~/lib/instances/types";

export default function More() {
  const { t } = useLingui();
  const { me, signOut, companyId, locationId } = useAuth();
  const { current } = useInstances();

  const companyName = me?.companies.find((c) => c.id === companyId)?.name ?? "";
  const locationName =
    me?.locations.find((l) => l.id === locationId)?.name ?? "";

  return (
    <Screen className="gap-4 py-4">
      <Heading>
        <Trans>More</Trans>
      </Heading>

      <ScrollView className="flex-1" contentContainerClassName="gap-4 pb-6">
        <Card className="gap-1">
          <Muted className="text-sm">
            <Trans>Signed in as</Trans>
          </Muted>
          <Body className="font-semibold">{me?.user.name ?? ""}</Body>
          <Muted className="text-sm">{me?.user.email ?? ""}</Muted>
        </Card>

        <Card className="gap-3">
          <View className="gap-1">
            <Muted className="text-sm">
              <Trans>Server</Trans>
            </Muted>
            <Body className="font-semibold">
              {current ? instanceLabel(current) : ""}
            </Body>
            <Muted className="text-sm">{current?.serverUrl ?? ""}</Muted>
          </View>
          <Button
            variant="secondary"
            onPress={() => router.push("/(setup)/instances")}
          >
            {t`Switch server`}
          </Button>
        </Card>

        <Card className="gap-3">
          <View className="gap-1">
            <Muted className="text-sm">
              <Trans>Working at</Trans>
            </Muted>
            <Body className="font-semibold">{locationName}</Body>
            {companyName ? (
              <Muted className="text-sm">{companyName}</Muted>
            ) : null}
          </View>
          <Button
            variant="secondary"
            onPress={() => router.push("/(app)/context")}
          >
            {t`Change location`}
          </Button>
        </Card>

        {me?.instance.controlledEnvironment ? (
          <WarningNote>
            {t`This is a controlled environment. The app locks itself after a period of inactivity.`}
          </WarningNote>
        ) : null}

        {me?.instance.mode === "airgapped" ? (
          <WarningNote>
            {t`This server is air-gapped. The app talks to it and to nothing else.`}
          </WarningNote>
        ) : null}

        <Button
          variant="destructive"
          onPress={() => {
            Alert.alert(t`Sign out?`, t`You will need your email code again.`, [
              { text: t`Cancel`, style: "cancel" },
              {
                text: t`Sign out`,
                style: "destructive",
                onPress: async () => {
                  await signOut();
                  router.replace("/");
                }
              }
            ]);
          }}
        >
          {t`Sign out`}
        </Button>
      </ScrollView>
    </Screen>
  );
}
