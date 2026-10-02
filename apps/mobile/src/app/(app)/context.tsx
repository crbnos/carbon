// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Body, Button, Card, Heading, Muted, Screen } from "~/components/ui";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * Company and location. Both are required before any screen loads, because
 * every query key starts with them (see `lib/query/keys.ts`).
 */
export default function ContextPicker() {
  const { t } = useLingui();
  const { me, companyId, setCompanyId, locationId, setLocationId } = useAuth();

  const locations = useMemo(
    () =>
      me?.locations.filter((l) => !companyId || l.companyId === companyId) ??
      [],
    [me, companyId]
  );

  return (
    <Screen className="gap-5 py-6">
      <View className="gap-2">
        <Heading>
          <Trans>Where are you working?</Trans>
        </Heading>
        <Muted>
          <Trans>You can change this later from More.</Trans>
        </Muted>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-5 pb-4">
        {(me?.companies.length ?? 0) > 1 ? (
          <View className="gap-2">
            <Muted className="text-sm">
              <Trans>Company</Trans>
            </Muted>
            {me?.companies.map((company) => (
              <Pressable
                key={company.id}
                onPress={() => {
                  setCompanyId(company.id);
                  // A location from the previous company would be a
                  // cross-tenant read; clear it by choosing the first of the new.
                  const first = me.locations.find(
                    (l) => l.companyId === company.id
                  );
                  if (first) setLocationId(first.id);
                }}
              >
                <Card
                  className={
                    company.id === companyId ? "border-ring" : undefined
                  }
                >
                  <Body className="font-semibold">{company.name}</Body>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View className="gap-2">
          <Muted className="text-sm">
            <Trans>Location</Trans>
          </Muted>
          {locations.map((location) => (
            <Pressable
              key={location.id}
              onPress={() => setLocationId(location.id)}
            >
              <Card
                className={
                  location.id === locationId ? "border-ring" : undefined
                }
              >
                <Body className="font-semibold">{location.name}</Body>
              </Card>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Button
        disabled={!companyId || !locationId}
        onPress={() => router.replace("/(app)/(tabs)/operations")}
      >
        {t`Continue`}
      </Button>
    </Screen>
  );
}
