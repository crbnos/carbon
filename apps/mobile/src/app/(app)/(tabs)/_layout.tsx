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
import { useLayout } from "~/components/useLayout";
import { OperatorHeader } from "~/features/console/OperatorHeader";

/**
 * Operations · Picking · Scan · Timecard · More.
 *
 * Tab bar is 64pt with `text-sm` labels, not the platform default: the floor
 * rule is that every operator target is at least 48pt, and the tab bar is the
 * one control that is always on screen.
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

  return (
    <View className="flex-1">
      <OperatorHeader />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarPosition: isSplit ? "left" : "bottom",
          tabBarStyle: isSplit
            ? // Sized like web's sidebar: wide enough for a label beside its
              // icon, with the items starting at the top rather than centred.
              { width: 220, paddingTop: 12 }
            : { height: 64, paddingBottom: 8, paddingTop: 8 },
          tabBarLabelStyle: { fontSize: 13 },
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
            title: t`Time card`,
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
