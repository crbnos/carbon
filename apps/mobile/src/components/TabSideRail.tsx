// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Image } from "expo-image";
import type { BottomTabBarProps } from "expo-router/tabs";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
 *
 * It is web MES's **collapsed** rail: the Carbon mark at the top, then icons
 * alone. No labels — web's collapsed rail has none, and the earlier version
 * that stacked a label under each icon needed 88pt to do it. At 68pt the iPad
 * keeps ~850pt for the work beside the 260pt dock, and the icons still sit on
 * 56pt targets, above the floor for a gloved thumb.
 *
 * Dropping the labels costs discoverability that web recovers with a hover
 * tooltip, which a tablet has no equivalent for. Every entry still carries
 * its `accessibilityLabel`, so VoiceOver reads the name the label used to
 * show — but this is the one deliberate departure from web worth revisiting:
 * past about ten icons the rail is harder to learn than web's labelled list,
 * and widening it to ~84pt for short labels is a small change if it proves
 * so on the floor.
 *
 * **It scrolls, and it is grouped.** The list grew from five entries to the
 * whole of web's sidebar, and more are coming (Jobs, Maintenance, the
 * inventory adjustments). Thirteen 56pt items plus the mark is ~773pt of an
 * iPad's ~776pt usable height — it fits by three points and nothing else
 * ever would, so the rail scrolls rather than clipping its last entry on a
 * smaller tablet. The separators are web's own groups (Operations, then the
 * tools), and they are what keeps a scrolling column of bare icons
 * scannable.
 *
 * The phone is untouched: it still gets the library's bottom bar, which is
 * correct there and already handles its own home-indicator inset.
 *
 * Colours are explicit for the reason above. Active is `foreground` on a
 * `muted` fill, never an accent: colour in this app is semantic — green runs,
 * red failed, orange needs attention — and spending it on "which tab am I on"
 * is what makes a status badge stop meaning anything.
 */

/** Icon-only, like web's collapsed rail, on a 56pt target. */
export const RAIL_WIDTH = 68;

/**
 * Where web's sidebar groups end, named by the route that closes each one.
 *
 * Web labels its groups (Operations / Inventory Adjustments / Tools); a 68pt
 * rail has no room for a label, so the grouping survives as a rule instead.
 * On a column of bare icons that rule is the only thing saying Scan and Time
 * are a different kind of thing from the four queues above them.
 */
const GROUP_ENDS = new Set(["picking", "timecard"]);

/**
 * A count on an icon, as web puts one on Active and Maintenance.
 *
 * Top-RIGHT of the icon rather than beside it, because there is no beside:
 * the rail is 68pt and the icon fills it. Clamped at 99 so a plant with a
 * hundred running operations does not widen the rail by itself.
 */
function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View className="absolute -right-1 -top-1 h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1">
      <Text className="text-[11px] font-semibold text-primary-foreground">
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  );
}

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
      {/*
        The mark, as web's rail has it. It is not a button: there is nothing
        above Operations to navigate to, and a logo that looks tappable and
        does nothing is worse than one that plainly does not.
      */}
      <View className="mb-2 items-center">
        <Image
          source={require("~/assets/images/splash-icon.png")}
          style={{ width: 28, height: 28 }}
          contentFit="contain"
          accessibilityLabel="Carbon"
        />
      </View>
      <View className="mx-3 mb-2 h-px bg-border" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
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

          const item = (
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
              className={`mx-2 mb-1 h-14 items-center justify-center rounded-lg ${
                focused ? "bg-muted" : "active:opacity-60"
              }`}
            >
              <View>
                {options.tabBarIcon?.({ focused, color, size: 24 })}
                {/*
                  `tabBarBadge` is the navigator's own prop, so a screen asks
                  for a count the way it would with the library's bar and
                  this rail is not a special case to remember.
                */}
                <Badge count={Number(options.tabBarBadge ?? 0)} />
              </View>
            </Pressable>
          );

          // The rule goes AFTER the group's last entry. Never after the final
          // icon on screen — a trailing rule reads as a list that got cut off
          // rather than as a boundary.
          return GROUP_ENDS.has(route.name) ? (
            <View key={route.key}>
              {item}
              <View className="mx-4 my-2 h-px bg-border" />
            </View>
          ) : (
            item
          );
        })}
      </ScrollView>
    </View>
  );
}
