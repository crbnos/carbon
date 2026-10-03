// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Building2, Check, MapPin } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import {
  Body,
  Button,
  ErrorNote,
  Heading,
  Muted,
  Screen
} from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { ApiClientError } from "~/lib/api/errors";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * Company and location. Both are required before any screen loads, because
 * every query key starts with them (see `lib/query/keys.ts`).
 *
 * Choosing a company RE-READS the account for that company (`switchCompany`).
 * `/me` describes one company at a time — its locations, the employee's
 * default location, the permissions — so the list of locations under a company
 * is only ever the list for the company that is current. Before that, picking
 * another company filtered the previous company's locations by the new id,
 * found none, and kept the old location: an empty list and a board that asked
 * one tenant for another tenant's location.
 *
 * Each location says how many work centers it has. A location with none is a
 * real thing — a head office beside a plant — and opening the schedule on it
 * shows an empty board that reads as "the app lost my work centers".
 */
export default function ContextPicker() {
  const { t } = useLingui();
  const colors = useThemeColors();
  const { me, companyId, switchCompany, locationId, setLocationId } = useAuth();
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locations = useMemo(
    () => me?.locations.filter((l) => l.companyId === companyId) ?? [],
    [me, companyId]
  );

  const workCenterCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const workCenter of me?.workCenters ?? []) {
      counts.set(
        workCenter.locationId,
        (counts.get(workCenter.locationId) ?? 0) + 1
      );
    }
    return counts;
  }, [me]);

  const choose = async (id: string) => {
    if (id === companyId || switching) return;
    setSwitching(id);
    setError(null);
    try {
      await switchCompany(id);
    } catch (cause) {
      setError(
        cause instanceof ApiClientError && cause.message
          ? cause.message
          : t`Could not switch company`
      );
    } finally {
      setSwitching(null);
    }
  };

  const multipleCompanies = (me?.companies.length ?? 0) > 1;

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
        {multipleCompanies ? (
          <View className="gap-2">
            <Muted className="text-sm">
              <Trans>Company</Trans>
            </Muted>
            {me?.companies.map((company) => {
              const selected = company.id === companyId;
              return (
                <Pressable
                  key={company.id}
                  onPress={() => choose(company.id)}
                  disabled={switching !== null}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={`min-h-[56px] flex-row items-center gap-3 rounded-lg border bg-card px-4 active:opacity-70 ${
                    selected ? "border-primary" : "border-border"
                  }`}
                >
                  <Building2 size={20} color={colors.mutedForeground} />
                  <Body className="flex-1 font-semibold">{company.name}</Body>
                  {switching === company.id ? (
                    <ActivityIndicator />
                  ) : selected ? (
                    <Check size={20} color={colors.foreground} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <View className="gap-2">
          <Muted className="text-sm">
            <Trans>Location</Trans>
          </Muted>
          {!companyId ? (
            <Muted>
              <Trans>Choose a company to see its locations.</Trans>
            </Muted>
          ) : locations.length === 0 ? (
            <Muted>
              <Trans>This company has no locations yet.</Trans>
            </Muted>
          ) : (
            locations.map((location) => {
              const selected = location.id === locationId;
              const count = workCenterCount.get(location.id) ?? 0;
              return (
                <Pressable
                  key={location.id}
                  onPress={() => setLocationId(location.id)}
                  disabled={switching !== null}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={`min-h-[64px] flex-row items-center gap-3 rounded-lg border bg-card px-4 py-2 active:opacity-70 ${
                    selected ? "border-primary" : "border-border"
                  }`}
                >
                  <MapPin size={20} color={colors.mutedForeground} />
                  <View className="min-w-0 flex-1">
                    <Body className="font-semibold">{location.name}</Body>
                    <Muted className="text-sm">
                      {count === 0
                        ? t`No work centers`
                        : count === 1
                          ? t`1 work center`
                          : t`${count} work centers`}
                    </Muted>
                  </View>
                  {selected ? (
                    <Check size={20} color={colors.foreground} />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      <Button
        disabled={!companyId || !locationId || switching !== null}
        onPress={() => router.replace("/(app)/(tabs)/operations")}
      >
        {t`Continue`}
      </Button>
    </Screen>
  );
}
