// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { BottomTabBarProps } from "expo-router/tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "./useThemeColor";

/**
 * The tab bar as a left rail, for a landscape tablet.
 *
 * React Navigation can place its own bar on the left (`tabBarPosition`), and
 * that is what this app used first. Three things made it unusable on an iPad,
 * all of them in the library's own sidebar branch:
 *
 * 1. **It was 360pt wide.** With labels beside icons the bar applies
 *    `minWidth: getDefaultSidebarWidth(size)`, and `tabBarStyle` is merged
 *    BEFORE that, so our `width: 220` never won. On a 1180pt iPad the nav took
 *    a third of the screen, and the operation screen — nav plus the 260pt
 *    control dock — was left about 560pt for the work itself.
 * 2. **It sat under the status bar.** The library pads a sidebar by
 *    `spacing + insets.top`; our `tabBarStyle` set `paddingTop: 12`, and since
 *    `tabBarStyle` is applied LAST that replaced the inset with 12. The first
 *    item rendered under the clock.
 * 3. **The active tab was iOS blue.** This app has no React Navigation
 *    `ThemeProvider`, so the bar's own active-pill colour came from React
 *    Navigation's built-in LIGHT theme whatever the app was doing.
 *
 * Rather than fight a style that is merged in a fixed order, the rail is ours.
 * It is 88pt — the width of an icon over a short label at the 48pt touch floor,
 * which is what web MES's collapsed nav rail amounts to on a device with no
 * hover — so the iPad keeps about 830pt for the work beside the dock.
 *
 * The phone is untouched: it still gets the library's bottom bar, which is
 * correct there and already handles its own home-indicator inset.
 *
 * Colours are explicit for the reason above. Active is `foreground` on a
 * `muted` fill, never an accent: colour in this app is semantic — green runs,
 * red failed, orange needs attention — and spending it on "which tab am I on"
 * is what makes a status badge stop meaning anything.
 */

/** Icon over a label, at the 48pt touch floor. */
export const RAIL_WIDTH = 88;

export function TabSideRail({
  state,
  descriptors,
  navigation,
  insets,
  topInset
}: BottomTabBarProps & {
  /**
   * The status bar's inset, or 0 when something above the rail already clears
   * it (the shared-terminal operator header). The rail runs the full height of
   * the screen beside the content, so nothing else owns this for it.
   */
  topInset: number;
}) {
  const colors = useThemeColors();

  return (
    <View
      accessibilityRole="tablist"
      className="border-r border-border bg-card"
      style={{
        // The inset is added to the width rather than taken out of it, so the
        // items keep their full 88pt next to a rounded display edge.
        width: RAIL_WIDTH + insets.left,
        paddingLeft: insets.left,
        paddingTop: topInset + 8,
        paddingBottom: insets.bottom + 8
      }}
    >
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options;
        if (!options) return null;
        // `href={null}` on a Tabs.Screen hides it by setting this; expo-router
        // writes the same style for a route that should not appear in the bar.
        const itemStyle = StyleSheet.flatten(options.tabBarItemStyle);
        if (itemStyle?.display === "none") return null;

        const focused = state.index === index;
        const color = focused ? colors.foreground : colors.mutedForeground;
        const label =
          typeof options.tabBarLabel === "string"
            ? options.tabBarLabel
            : (options.title ?? route.name);

        const onPress = () => {
          // Emitted even for the focused tab: a nested stack listens for this
          // to pop back to its root, which is how tapping Schedule from an
          // operation returns to the board.
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={() =>
              navigation.emit({ type: "tabLongPress", target: route.key })
            }
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            testID={options.tabBarButtonTestID}
            className={`mx-2 mb-1 min-h-[60px] items-center justify-center gap-1 rounded-lg px-1 py-2 ${
              focused ? "bg-muted" : "active:opacity-60"
            }`}
          >
            {options.tabBarIcon?.({ focused, color, size: 24 })}
            <Text
              numberOfLines={1}
              className="text-xs font-medium"
              style={{ color }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
