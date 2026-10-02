// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

/**
 * The operation screen's tabs, as web MES's own `TabsList` / `TabsTrigger`
 * (`packages/react/src/Tabs.tsx`): a SEGMENTED CONTROL — a muted, bordered,
 * rounded track with the selected tab lifted out of it in the background
 * colour — not the underlined row this used to be. An operator who moves
 * between a browser and a tablet during one shift should recognise the
 * control, not only the words in it.
 *
 * Built from `Pressable` rather than a tab library because of one behaviour
 * the libraries make awkward: a tab that is NOT available for this operation
 * stays visible and disabled with a reason, instead of being dropped from the
 * row. An operator who cannot find Instructions assumes the app is broken; one
 * who reads "No instructions on this operation" knows the job is.
 *
 * What is deliberately NOT copied is the sizing. Web's triggers are `text-sm`
 * with `py-1` because they assume a mouse; every tab here is a 48pt target
 * with `text-base` on it.
 *
 * The track scrolls horizontally, so a fifth tab or a long translation never
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
    // The gutter is the wrapper's, so the track itself hugs its tabs the way
    // web's `inline-flex` TabsList does rather than stretching edge to edge.
    // The bottom rule is web's `Separator` between its context bar and the
    // workspace — the tab row sits exactly where that line falls here.
    <View className="border-b border-border bg-background px-4 py-2">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row items-center gap-1 rounded-lg border border-border bg-muted p-1">
          {tabs.map((tab) => {
            const selected = tab.value === value;
            return (
              <Pressable
                key={tab.value}
                onPress={() => onChange(tab.value)}
                disabled={tab.disabled}
                accessibilityRole="tab"
                accessibilityState={{ selected, disabled: tab.disabled }}
                accessibilityHint={
                  tab.disabled ? tab.disabledReason : undefined
                }
                className={`min-h-[48px] flex-row items-center justify-center gap-2 rounded-md px-4 ${
                  selected ? "bg-background" : ""
                } ${tab.disabled ? "opacity-50" : "active:opacity-70"}`}
              >
                <Text
                  className={`text-base font-medium ${
                    selected ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {tab.label}
                </Text>
                {tab.badge ? (
                  // Web MES has no counts on these tabs; they stay because an
                  // operator should see there are six materials without
                  // opening the tab to find out. The pill inverts against
                  // whichever surface it sits on so it reads on both.
                  <View
                    className={`rounded-full px-2 py-0.5 ${
                      selected ? "bg-muted" : "bg-background"
                    }`}
                  >
                    <Text className="text-sm text-muted-foreground">
                      {tab.badge}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
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
