// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

/**
 * The operation screen's tabs, in web MES's order.
 *
 * Built from `Pressable` rather than a tab library because this needs exactly
 * one behaviour the libraries make awkward: a tab that is NOT available for
 * this operation stays visible and disabled with a reason, rather than being
 * dropped from the row. An operator who cannot find the Instructions tab
 * assumes the app is broken; one who reads "No instructions on this operation"
 * knows the job is.
 *
 * The row scrolls horizontally, so a fifth tab or a long translation never
 * pushes a tab off-screen where it cannot be reached.
 */

export type TabDef<T extends string> = {
  value: T;
  label: string;
  /** Rendered after the label — a count, usually. */
  badge?: string;
  disabled?: boolean;
  /** Why it is disabled. Read out, and shown when the tab is selected. */
  disabledReason?: string;
};

export function TabBar<T extends string>({
  tabs,
  value,
  onChange
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-1 px-4 py-2"
      className="border-b border-border bg-background"
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            disabled={tab.disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: tab.disabled }}
            accessibilityHint={tab.disabled ? tab.disabledReason : undefined}
            className={`min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg px-4 ${
              selected ? "bg-muted" : ""
            } ${tab.disabled ? "opacity-40" : "active:opacity-70"}`}
          >
            <Text
              className={`text-base ${
                selected
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {tab.label}
            </Text>
            {tab.badge ? (
              <View className="rounded-full bg-background px-2 py-0.5">
                <Text className="text-sm text-muted-foreground">
                  {tab.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function TabPanel({
  active,
  children
}: {
  active: boolean;
  children: ReactNode;
}) {
  if (!active) return null;
  return <View className="flex-1">{children}</View>;
}
