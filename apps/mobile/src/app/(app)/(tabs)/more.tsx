// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MES_LOCALES } from "@carbon/mes-core";
import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import {
  Body,
  Button,
  Card,
  Heading,
  Muted,
  Screen,
  WarningNote
} from "~/components/ui";
import { analyticsDecision } from "~/lib/analytics/policy";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useIdleLock } from "~/lib/idle/useIdleLock";
import { useInstances } from "~/lib/instances/InstanceProvider";
import { instanceLabel } from "~/lib/instances/types";
import { usePreferences } from "~/lib/preferences/PreferencesProvider";
import type {
  LocalePreference,
  ThemePreference
} from "~/lib/preferences/store";

/**
 * The language a locale is named IN — its own. A Polish operator looking for
 * their language scans for "Polski", not for "Polish" spelled in English.
 * These are the same labels `packages/locale`'s `languageNativeLabels` uses.
 */
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  it: "Italiano",
  ja: "日本語",
  zh: "中文",
  fr: "Français",
  pl: "Polski",
  pt: "Português",
  ru: "Русский",
  hi: "हिन्दी",
  tr: "Türkçe",
  ko: "한국어"
};

/** A row of choices, one selected. Used for both language and theme. */
function ChoiceRow<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            className={`min-h-[48px] justify-center rounded-lg border px-4 ${
              selected
                ? "border-primary bg-muted"
                : "border-border bg-card active:opacity-70"
            }`}
          >
            <Text
              className={`text-base ${
                selected ? "font-semibold text-foreground" : "text-foreground"
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function More() {
  const { t } = useLingui();
  const { me, signOut, companyId, locationId } = useAuth();
  const { current } = useInstances();
  const { locale, theme, setLocale, setTheme } = usePreferences();
  const idle = useIdleLock();
  const analytics = analyticsDecision(me);

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

        <Card className="gap-3">
          <Muted className="text-sm">
            <Trans>Language</Trans>
          </Muted>
          <ChoiceRow<LocalePreference>
            value={locale}
            onChange={setLocale}
            options={[
              { value: "device", label: t`Device language` },
              ...MES_LOCALES.map((code) => ({
                value: code as LocalePreference,
                label: LOCALE_LABELS[code] ?? code
              }))
            ]}
          />
        </Card>

        <Card className="gap-3">
          <Muted className="text-sm">
            <Trans>Appearance</Trans>
          </Muted>
          <ChoiceRow<ThemePreference>
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: t`Follow the device` },
              { value: "light", label: t`Light` },
              { value: "dark", label: t`Dark` }
            ]}
          />
        </Card>

        <Card className="gap-2">
          <Muted className="text-sm">
            <Trans>Privacy</Trans>
          </Muted>
          <Body className="text-sm">
            {analytics.enabled
              ? t`Usage analytics are on for this server.`
              : analytics.reason === "airgapped"
                ? t`Analytics are off: this server is air-gapped.`
                : analytics.reason === "controlled_environment"
                  ? t`Analytics are off: this is a controlled environment.`
                  : t`Analytics are off: this server has not configured them.`}
          </Body>
          {idle.active ? (
            <Body className="text-sm">
              {idle.action === "pin_out"
                ? t`After a period of inactivity the pinned operator is signed out.`
                : t`After a period of inactivity this device signs itself out.`}
            </Body>
          ) : null}
        </Card>

        {__DEV__ ? (
          <Button
            variant="secondary"
            onPress={() => router.push("/(app)/_gallery")}
          >
            {t`Design primitives (dev)`}
          </Button>
        ) : null}

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
