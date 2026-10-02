// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, Pressable, View } from "react-native";
import {
  Body,
  Button,
  Card,
  EmptyState,
  Heading,
  Muted,
  Screen
} from "~/components/ui";
import { useInstances } from "~/lib/instances/InstanceProvider";
import { instanceLabel } from "~/lib/instances/types";

/**
 * Every linked Carbon, and which one is in use.
 *
 * Switching throws away the query cache, the Supabase client and the session in
 * use (see InstanceProvider) — a company id is not unique across instances, so
 * a staging server restored from a production backup has the SAME ids and
 * nothing but the instance can keep the two apart.
 */
export default function Instances() {
  const { t } = useLingui();
  const { instances, current, switchTo, unlink } = useInstances();
  const [busy, setBusy] = useState(false);

  return (
    <Screen className="gap-4 py-6">
      <Heading>
        <Trans>Servers</Trans>
      </Heading>

      <FlatList
        data={instances}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListEmptyComponent={
          <EmptyState
            title={t`No servers yet`}
            description={t`Connect to a Carbon to get started.`}
          />
        }
        renderItem={({ item }) => {
          const isCurrent = item.id === current?.id;
          return (
            <Card className="gap-3">
              <Pressable
                disabled={busy || isCurrent}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await switchTo(item.id);
                    router.replace("/");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <View className="gap-1">
                  <Body className="font-semibold">{instanceLabel(item)}</Body>
                  <Muted className="text-sm">{item.serverUrl}</Muted>
                  {isCurrent ? (
                    <Muted className="text-sm font-semibold">
                      <Trans>In use</Trans>
                    </Muted>
                  ) : null}
                  {item.scheme === "http" ? (
                    <Muted className="text-sm">
                      <Trans>Insecure connection</Trans>
                    </Muted>
                  ) : null}
                </View>
              </Pressable>
              <Button
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  Alert.alert(
                    t`Remove this server?`,
                    t`Signing back in needs the address again. Anything waiting to send is discarded.`,
                    [
                      { text: t`Cancel`, style: "cancel" },
                      {
                        text: t`Remove`,
                        style: "destructive",
                        onPress: async () => {
                          setBusy(true);
                          try {
                            await unlink(item.id);
                            router.replace("/");
                          } finally {
                            setBusy(false);
                          }
                        }
                      }
                    ]
                  );
                }}
              >
                {t`Remove`}
              </Button>
            </Card>
          );
        }}
      />

      <Button onPress={() => router.push("/(setup)/connect")}>
        {t`Add a server`}
      </Button>
    </Screen>
  );
}
