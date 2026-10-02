// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsTablet } from "./useIsTablet";

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
 */
export function ActionDock({
  children,
  layout
}: {
  children: ReactNode;
  /** Forced in the dev gallery, so both shapes can be seen on one device. */
  layout?: "column" | "bar";
}) {
  const isTablet = useIsTablet();
  const insets = useSafeAreaInsets();
  const asColumn = (layout ?? (isTablet ? "column" : "bar")) === "column";

  if (asColumn) {
    return (
      <View className="w-[260px] border-l border-border bg-card">
        <ScrollView
          contentContainerClassName="gap-4 p-4"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      // Wraps, and every child may shrink. The operation dock carries a
      // work-type toggle, a 96pt hero button and two more controls; on a phone
      // that is wider than the screen, and without wrapping the row simply
      // bled off the right edge with the last control unreachable.
      className="flex-row flex-wrap items-center justify-center gap-3 border-t border-border bg-card px-4 pt-3"
      style={{ paddingBottom: insets.bottom + 12 }}
    >
      {children}
    </View>
  );
}
