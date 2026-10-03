// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { TriangleAlert } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useThemeColors } from "~/components/useThemeColor";

/**
 * Every work centre on the board, as one row of chips — the phone's answer to
 * the three columns a browser shows side by side.
 *
 * A phone has room for ONE column. Before this, the only sign that six more
 * existed was a sliver of the next card at the right edge, and an operator
 * looking for "Assembly Line" had no way to know whether it was four swipes
 * away or missing. The strip names them all, says how much is queued at each,
 * marks the one on screen, and jumps to any of them in one tap.
 *
 * The count is on the chip because it is the question the board answers:
 * where is the work. The dot is web's `PulsingDot` — green while something is
 * running there — and a blocked centre is the one chip drawn destructive,
 * because it is the one an operator must not walk to.
 */
export type StripColumn = {
  id: string;
  title: string;
  count: number;
  active: boolean;
  isBlocked: boolean;
};

export function WorkCenterStrip({
  columns,
  current,
  onSelect
}: {
  columns: StripColumn[];
  /** Index of the column the board is showing. */
  current: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const scroller = useRef<ScrollView>(null);
  /** Each chip's left edge, so the current one can be kept in view. */
  const offsets = useRef<number[]>([]);

  // Swiping the board moves `current`; the strip follows, or the highlighted
  // chip would slide out of sight while the column it names is on screen.
  useEffect(() => {
    const x = offsets.current[current];
    if (x != null) {
      scroller.current?.scrollTo({ x: Math.max(0, x - 48), animated: true });
    }
  }, [current]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 pr-4"
      accessibilityRole="tablist"
    >
      {columns.map((column, index) => {
        const selected = index === current;
        return (
          <Pressable
            key={column.id}
            onPress={() => onSelect(index)}
            onLayout={(event) => {
              offsets.current[index] = event.nativeEvent.layout.x;
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={
              column.isBlocked
                ? t`${column.title}, blocked for maintenance`
                : t`${column.title}, ${column.count} operations`
            }
            className={`min-h-[44px] flex-row items-center gap-2 rounded-full border px-3 active:opacity-70 ${
              column.isBlocked
                ? "border-destructive bg-destructive/15"
                : selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card"
            }`}
          >
            {column.isBlocked ? (
              <TriangleAlert size={14} color={colors.destructive} />
            ) : (
              <View
                className={`size-2 rounded-full ${
                  column.active ? "bg-emerald-500" : "bg-muted-foreground/40"
                }`}
              />
            )}
            <Text
              className={`text-sm ${
                selected ? "font-semibold text-foreground" : "text-foreground"
              }`}
              numberOfLines={1}
            >
              {column.title}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {column.count}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
