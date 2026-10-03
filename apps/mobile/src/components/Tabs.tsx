// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useIsTablet } from "./useIsTablet";

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
 * **On a phone the track fills the row and the tabs share it equally.** It used
 * to hug its tabs and scroll, as web's inline list does — but four `text-base`
 * tabs with 16pt of padding each are wider than a phone, so the last one was
 * cut off mid-word ("Rec", "Note") with nothing to say the row scrolled. A tab
 * an operator cannot see is a tab that does not exist. Up to four tabs now
 * always fit: the label drops to `text-sm` and shrinks before it truncates.
 *
 * A tablet keeps web's hugging track, and five or more tabs still scroll, so a
 * long translation never pushes a tab somewhere it cannot be reached.
 */

/** More than this and equal shares get too narrow to read; scroll instead. */
const MAX_SHARED_TABS = 4;

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
  const isTablet = useIsTablet();
  // Share the row only where the tabs would otherwise overflow it.
  const shared = !isTablet && tabs.length <= MAX_SHARED_TABS;

  const track = (
    <View
      className={`flex-row items-center gap-1 rounded-lg border border-border bg-muted p-1 ${
        shared ? "w-full" : ""
      }`}
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
            className={`min-h-[44px] flex-row items-center justify-center gap-1.5 rounded-md ${
              shared ? "min-w-0 flex-1 px-1" : "px-4"
            } ${selected ? "bg-background" : ""} ${
              tab.disabled ? "opacity-50" : "active:opacity-70"
            }`}
          >
            <Text
              className={`shrink font-medium ${
                shared ? "text-sm" : "text-base"
              } ${selected ? "text-foreground" : "text-muted-foreground"}`}
              numberOfLines={1}
              // Shrinks before it truncates: "Instructions" beside a count is
              // the longest thing this row carries, and an ellipsis in a tab
              // label is a tab nobody can name.
              adjustsFontSizeToFit={shared}
              minimumFontScale={0.8}
            >
              {tab.label}
            </Text>
            {tab.badge ? (
              // Web MES has no counts on these tabs; they stay because an
              // operator should see there are six materials without opening
              // the tab to find out. The pill inverts against whichever
              // surface it sits on so it reads on both.
              <View
                className={`rounded-full py-0.5 ${shared ? "px-1.5" : "px-2"} ${
                  selected ? "bg-muted" : "bg-background"
                }`}
              >
                <Text
                  className={`text-muted-foreground ${
                    shared ? "text-xs" : "text-sm"
                  }`}
                >
                  {tab.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  return (
    // The gutter is the wrapper's. The bottom rule is web's `Separator`
    // between its context bar and the workspace — the tab row sits exactly
    // where that line falls here.
    <View className="border-b border-border bg-background px-4 py-2">
      {shared ? (
        track
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {track}
        </ScrollView>
      )}
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
