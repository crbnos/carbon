// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Polyfills must load before anything touches Intl (Lingui plural rules,
// @internationalized/date). Keep this import first.
import "~/i18n/polyfills";
import "../../global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Toaster } from "sonner-native";
import { ScopedTheme } from "uniwind";
import { I18nRoot } from "~/i18n";
import { AuthProvider } from "~/lib/auth/AuthProvider";
import { InstanceProvider } from "~/lib/instances/InstanceProvider";
import {
  PreferencesProvider,
  usePreferences
} from "~/lib/preferences/PreferencesProvider";
import { createQueryClient } from "~/lib/query/client";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Preferences sit outermost so the chosen theme and language apply to
            every screen, including the ones shown before sign-in. */}
        <PreferencesProvider>
          <Themed />
        </PreferencesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Everything below the preferences.
 *
 * `ScopedTheme` is what makes an explicit light/dark choice take effect:
 * Uniwind otherwise follows the OS, and there is no way to override a class's
 * theme from outside the tree it renders in. `resolvedScheme` has already
 * turned "system" into the OS's current answer, so this always names one.
 */
function Themed() {
  const [queryClient] = useState(createQueryClient);
  const { resolvedLocale, resolvedScheme } = usePreferences();

  return (
    <ScopedTheme theme={resolvedScheme}>
      {/* QueryClient is above InstanceProvider on purpose: switching
            instance clears the cache, so the provider needs the client. */}
      <QueryClientProvider client={queryClient}>
        <InstanceProvider>
          <AuthProvider>
            <I18nRoot locale={resolvedLocale}>
              {/* Sheets are presented imperatively from inside a screen, so
                    the provider that hosts them has to sit above the Stack. */}
              <BottomSheetModalProvider>
                <Stack screenOptions={{ headerShown: false }}>
                  {/* Scan is a TAB, not a modal route — there is no
                      `(app)/scan.tsx`, and declaring one here only produced an
                      Expo Router warning about a route that does not exist. */}
                  <Stack.Screen
                    name="(app)/pin"
                    options={{ presentation: "fullScreenModal" }}
                  />
                </Stack>
                {/*
                  Web MES puts toasts bottom-LEFT because its dock sits
                  bottom-right. sonner-native offers only top-center,
                  bottom-center and center, and on a phone the dock is a full
                  bottom bar anyway — so bottom-center, lifted clear of the
                  dock, keeps the rule it serves: never cover the primary
                  action.
                */}
                <Toaster position="bottom-center" offset={96} />
              </BottomSheetModalProvider>
            </I18nRoot>
          </AuthProvider>
        </InstanceProvider>
      </QueryClientProvider>
    </ScopedTheme>
  );
}
