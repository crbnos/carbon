// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePreferences } from "~/lib/preferences/PreferencesProvider";
import { useIsTablet } from "./useIsTablet";
import { useThemeColors } from "./useThemeColor";

/**
 * Exactly one dock per screen, in the one place the design rules allow it: a
 * right-hand column on a tablet, a bottom bar on a phone.
 *
 * The column width matches web MES's `--controls-width`, so an operator moving
 * between a browser and a tablet finds the controls in the same place. On a
 * phone it is a bottom bar padded by the safe-area inset — without that, the
 * primary action sits under the home indicator and simply cannot be pressed.
 *
 * The tablet column scrolls. A dock with a work-type toggle, a hero button, a
 * log button and a more-actions button does not fit a landscape iPad in split
 * view, and a control that is off-screen with no way to reach it is worse than
 * one the operator has to scroll to.
 *
 * **`drawer` is the phone's escape from its own height.** On a phone the bar
 * wraps, and a full-width control in it — the operation screen's work-type
 * toggle — costs a whole second row, about a quarter of the screen, taken from
 * the work the operator is reading. Anything passed as `drawer` is therefore
 * hidden behind a handle there, while `children` stay on the bar. What goes in
 * it is set-once-a-shift state, never the primary action and never a quantity:
 * a control an operator reaches for every unit must not need two taps.
 *
 * On a TABLET the column has room, so `drawer` simply renders inline and there
 * is no handle — the same screen, the same controls, no second concept.
 */
export function ActionDock({
  children,
  drawer,
  layout
}: {
  children: ReactNode;
  /** Secondary controls. Collapsible on a phone, always shown on a tablet. */
  drawer?: ReactNode;
  /** Forced in the dev gallery, so both shapes can be seen on one device. */
  layout?: "column" | "bar";
}) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const isTablet = useIsTablet();
  // Read above the early return, with the other hooks: a tablet rotated into
  // split view switches branch, and a hook below it would stop being called.
  const { dockOpen, setDockOpen } = usePreferences();
  const asColumn = (layout ?? (isTablet ? "column" : "bar")) === "column";

  if (asColumn) {
    return (
      <View className="w-[260px] border-l border-border bg-card">
        <ScrollView
          contentContainerClassName="gap-4 p-4"
          showsVerticalScrollIndicator={false}
        >
          {drawer}
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <Animated.View
      // The height changes when the drawer opens, and the content above is a
      // scroll view that has to give the space back. `LinearTransition` is what
      // makes that read as a drawer rather than a jump.
      layout={LinearTransition.duration(180)}
      className="border-t border-border bg-card"
      style={{ paddingBottom: insets.bottom + 12 }}
    >
      {drawer ? (
        <>
          <Pressable
            onPress={() => setDockOpen(!dockOpen)}
            accessibilityRole="button"
            accessibilityState={{ expanded: dockOpen }}
            accessibilityLabel={dockOpen ? t`Hide options` : t`Show options`}
            // Full width so the handle is hit without aiming, and 44pt tall so
            // it clears the floor for a gloved thumb.
            className="min-h-[44px] flex-row items-center justify-center gap-2 active:opacity-60"
          >
            {dockOpen ? (
              <ChevronDown size={18} color={colors.mutedForeground} />
            ) : (
              <ChevronUp size={18} color={colors.mutedForeground} />
            )}
            <Text className="text-sm text-muted-foreground">
              {dockOpen ? t`Hide options` : t`Options`}
            </Text>
          </Pressable>
          {dockOpen ? <View className="gap-3 px-4 pb-3">{drawer}</View> : null}
        </>
      ) : null}

      <View
        // Wraps, and every child may shrink. The operation dock carries a
        // 96pt hero button and two more controls; on a narrow phone that is
        // wider than the screen, and without wrapping the row simply bled off
        // the right edge with the last control unreachable.
        className={`flex-row flex-wrap items-center justify-center gap-3 px-4 ${
          drawer ? "" : "pt-3"
        }`}
      >
        {children}
      </View>
    </Animated.View>
  );
}
