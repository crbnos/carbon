// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Polyfills must load before anything touches Intl (Lingui plural rules,
// @internationalized/date). Keep this import first.
import "~/i18n/polyfills";
import "../../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Toaster } from "sonner-native";
import { I18nRoot } from "~/i18n";
import { AuthProvider } from "~/lib/auth/AuthProvider";
import { InstanceProvider } from "~/lib/instances/InstanceProvider";
import { createQueryClient } from "~/lib/query/client";

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* QueryClient is above InstanceProvider on purpose: switching
            instance clears the cache, so the provider needs the client. */}
        <QueryClientProvider client={queryClient}>
          <InstanceProvider>
            <AuthProvider>
              <I18nRoot>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen
                    name="(app)/scan"
                    options={{ presentation: "modal" }}
                  />
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
              </I18nRoot>
            </AuthProvider>
          </InstanceProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
