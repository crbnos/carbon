// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Tabs } from "expo-router";
import {
  Activity,
  Briefcase,
  CalendarDays,
  ClipboardList,
  Clock,
  History,
  Menu,
  PackageCheck,
  ScanLine
} from "lucide-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TabSideRail } from "~/components/TabSideRail";
import { useLayout } from "~/components/useLayout";
import { useThemeColors } from "~/components/useThemeColor";
import { OperatorHeader } from "~/features/console/OperatorHeader";
import { useActiveQuery } from "~/features/operations/useQueueQueries";
import { useAuth } from "~/lib/auth/AuthProvider";

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
  // A landscape tablet puts the bar down the LEFT, which is web MES's nav
  // rail; a phone keeps it at the bottom, where a thumb is. `tabBarPosition`
  // is the navigator's own prop, so routing, state and deep links are
  // untouched — the bar simply renders on a different edge.
  //
  // On that edge the bar is OURS (`TabSideRail`), because the library's
  // sidebar branch forces a 360pt minimum width and merges `tabBarStyle` in an
  // order that makes both the width and the status-bar inset unfixable from
  // here. See the note in that file. The phone keeps the library's bar.
  const { isSplit } = useLayout();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // The operator header renders above the rail in shared-terminal mode and
  // already covers the top of the screen, so the rail must not inset again.
  const { terminalToken } = useAuth();
  const activeCount = useActiveQuery().data?.operations?.length ?? 0;

  return (
    <View className="flex-1">
      <OperatorHeader />
      <Tabs
        tabBar={
          isSplit
            ? (props) => (
                <TabSideRail
                  {...props}
                  topInset={terminalToken ? 0 : props.insets.top}
                />
              )
            : undefined
        }
        screenOptions={{
          headerShown: false,
          tabBarPosition: isSplit ? "left" : "bottom",
          tabBarActiveTintColor: colors.foreground,
          tabBarInactiveTintColor: colors.mutedForeground,
          sceneStyle: { backgroundColor: colors.background },
          // Only the phone's bar reads these; the rail styles itself.
          tabBarStyle: {
            // The bar itself, plus whatever the home indicator needs.
            height: 60 + insets.bottom,
            paddingBottom: insets.bottom,
            paddingTop: 8,
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.border
          },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "500" },
          tabBarLabelPosition: "below-icon"
        }}
      >
        <Tabs.Screen
          name="operations"
          options={{
            title: t`Schedule`,
            tabBarIcon: ({ color, size }) => (
              <CalendarDays color={color} size={size} />
            )
          }}
        />
        {/*
          The three queues are web's own OPERATIONS items, so on a tablet they
          are nav entries like everything else. On a PHONE the bar is full at
          five and a sixth truncates every label — the bug that made the bar
          unusable before — so there they are reached from More, which lists
          every destination the rail shows. `href: null` removes a screen from
          the bar without unrouting it, so More can still push to them.
        */}
        <Tabs.Screen
          name="assigned"
          options={{
            title: t`Assigned`,
            href: isSplit ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <ClipboardList color={color} size={size} />
            )
          }}
        />
        <Tabs.Screen
          name="active"
          options={{
            title: t`Active`,
            href: isSplit ? undefined : null,
            // Web badges this one with the live event count. The query is
            // already mounted by every queue screen and shares ONE cache
            // entry, so the badge costs no extra request and can never
            // disagree with the list it counts.
            tabBarBadge: activeCount || undefined,
            tabBarIcon: ({ color, size }) => (
              <Activity color={color} size={size} />
            )
          }}
        />
        <Tabs.Screen
          name="recent"
          options={{
            title: t`Recent`,
            href: isSplit ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <History color={color} size={size} />
            )
          }}
        />
        <Tabs.Screen
          name="jobs"
          options={{
            title: t`Jobs`,
            href: isSplit ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Briefcase color={color} size={size} />
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
