// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Tabs } from "expo-router";
import {
  ClipboardList,
  Clock,
  Menu,
  PackageCheck,
  ScanLine
} from "lucide-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "~/components/useLayout";
import { useThemeColors } from "~/components/useThemeColor";
import { OperatorHeader } from "~/features/console/OperatorHeader";

/**
 * Operations · Picking · Scan · Timecard · More.
 *
 * Tab bar is 64pt with `text-sm` labels, not the platform default: the floor
 * rule is that every operator target is at least 48pt, and the tab bar is the
 * one control that is always on screen.
 *
 * **Every colour here is set explicitly, and has to be.** This app has no
 * React Navigation `ThemeProvider` — `@react-navigation/native` is not a
 * direct dependency — so a navigator falls back to React Navigation's built-in
 * LIGHT theme whatever Uniwind is doing. That is why the bar rendered as a
 * white slab with an iOS-blue active tab under a dark app: nothing was wrong
 * with the theme, the bar simply was never told about it.
 *
 * The active tab is `foreground`, not a colour. Colour in this app is
 * semantic — green runs, red failed, orange needs attention — and spending it
 * on "which tab am I on" is what makes a status badge stop meaning anything.
 *
 * The height is `insets.bottom` plus the bar, never a bare number: an explicit
 * `height` overrides the inset React Navigation would otherwise add, which is
 * what pushed the labels down into the home indicator.
 *
 * In shared-terminal mode the operator header sits ABOVE the tabs, so whose
 * name the next write will carry is on screen no matter which tab the operator
 * is on. It renders nothing on a personal device.
 */
export default function TabsLayout() {
  const { t } = useLingui();
  // A landscape tablet puts the bar down the LEFT, which is web MES's sidebar;
  // a phone keeps it at the bottom, where a thumb is. `tabBarPosition` is the
  // navigator's own prop, so routing, state and deep links are untouched — the
  // bar simply renders on a different edge.
  const { isSplit } = useLayout();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1">
      <OperatorHeader />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarPosition: isSplit ? "left" : "bottom",
          tabBarActiveTintColor: colors.foreground,
          tabBarInactiveTintColor: colors.mutedForeground,
          sceneStyle: { backgroundColor: colors.background },
          tabBarStyle: isSplit
            ? // Sized like web's sidebar: wide enough for a label beside its
              // icon, with the items starting at the top rather than centred.
              {
                width: 220,
                paddingTop: 12,
                backgroundColor: colors.card,
                borderRightWidth: 1,
                borderRightColor: colors.border
              }
            : {
                // The bar itself, plus whatever the home indicator needs.
                height: 60 + insets.bottom,
                paddingBottom: insets.bottom,
                paddingTop: 8,
                backgroundColor: colors.card,
                borderTopWidth: 1,
                borderTopColor: colors.border
              },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "500" },
          tabBarLabelPosition: isSplit ? "beside-icon" : "below-icon",
          tabBarItemStyle: isSplit
            ? { justifyContent: "flex-start", paddingLeft: 8, height: 48 }
            : undefined
        }}
      >
        <Tabs.Screen
          name="operations"
          options={{
            title: t`Schedule`,
            tabBarIcon: ({ color, size }) => (
              <ClipboardList color={color} size={size} />
            )
          }}
        />
        <Tabs.Screen
          name="picking"
          options={{
            title: t`Picking`,
            tabBarIcon: ({ color, size }) => (
              <PackageCheck color={color} size={size} />
            )
          }}
        />
        <Tabs.Screen
          name="scan"
          options={{
            title: t`Scan`,
            tabBarIcon: ({ color, size }) => (
              <ScanLine color={color} size={size} />
            )
          }}
        />
        <Tabs.Screen
          name="timecard"
          options={{
            // "Time card" is two words in a fifth of a phone's width and
            // clipped; the screen itself still calls itself Time card.
            title: t`Time`,
            tabBarIcon: ({ color, size }) => <Clock color={color} size={size} />
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: t`More`,
            tabBarIcon: ({ color, size }) => <Menu color={color} size={size} />
          }}
        />
      </Tabs>
    </View>
  );
}
