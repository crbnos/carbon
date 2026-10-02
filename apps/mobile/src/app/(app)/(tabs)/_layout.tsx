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

/**
 * Operations · Picking · Scan · Timecard · More.
 *
 * Tab bar is 64pt with `text-sm` labels, not the platform default: the floor
 * rule is that every operator target is at least 48pt, and the tab bar is the
 * one control that is always on screen.
 */
export default function TabsLayout() {
  const { t } = useLingui();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { height: 64, paddingBottom: 8, paddingTop: 8 },
        tabBarLabelStyle: { fontSize: 13 }
      }}
    >
      <Tabs.Screen
        name="operations"
        options={{
          title: t`Operations`,
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
  );
}
