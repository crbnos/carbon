// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ProductionEvent } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { Hammer, HardHat, Timer } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "~/components/useThemeColor";
import type { WorkType } from "./logic";

/**
 * Setup · Labor · Machine — which kind of time the Start button will open.
 *
 * Ported from `Controls.tsx` `WorkTypeToggle`, including the rule that decides
 * which types EXIST: a type is offered only when the operation plans time for
 * it (`setupDuration > 0`). An operation with only labour time shows one
 * option, not three, so Start cannot open a machine event on a job that has no
 * machine step.
 *
 * It LOOKS like web's now too. Web builds this from `ToggleGroup`, which has no
 * track of its own — the items sit directly on the dock, each an icon over its
 * label, and the selected one fills with `primary` and flips its text to
 * `primary-foreground`. This used to be a bordered, muted segmented control,
 * which is the shape web gives its TABS, not its work-type switch.
 *
 * A green dot marks a type whose timer is already running (web's own
 * `-top-1 -right-1` badge), so an operator returning to a tablet can see what
 * is open before pressing anything.
 *
 * The sizing is NOT web's: its labels are `text-xxs` on a 48px item. Here the
 * item is a 56pt target with `text-sm` on it, which is the floor for a screen
 * read standing up and often gloved.
 *
 * **The items keep web's shape — a square each — and do not stretch.** They
 * used to share the row with `flex-1`, which is harmless with three and wrong
 * with one: an operation that plans only labour time rendered a single item
 * as wide as the screen, filled with `primary` and dimmed because it is not a
 * choice. That is a grey slab with "Labor" on it, and it read as a broken
 * button. One type is now shown as what it is — a label saying which time is
 * being recorded — at full strength, and it simply does not respond to a tap.
 */

const ICONS = { Setup: Timer, Labor: HardHat, Machine: Hammer } as const;

export function WorkTypeToggle({
  types,
  value,
  open,
  onChange
}: {
  types: WorkType[];
  value: WorkType;
  open: Partial<Record<WorkType, ProductionEvent | undefined>>;
  onChange: (type: WorkType) => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const labels: Record<WorkType, string> = {
    Setup: t`Setup`,
    Labor: t`Labor`,
    Machine: t`Machine`
  };
  // One type is not a choice. Web disables the group in that case rather than
  // hiding it, so the operator can still read what kind of time they are on.
  const locked = types.length <= 1;

  return (
    <View className="w-full flex-row items-center justify-between gap-3">
      <Text className="shrink text-sm text-muted-foreground">
        {locked ? t`Recording` : t`Record time as`}
      </Text>
      <View className="flex-row gap-1">
        {types.map((type) => {
          const Icon = ICONS[type];
          const selected = type === value;
          return (
            <Pressable
              key={type}
              onPress={() => onChange(type)}
              disabled={locked}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: locked }}
              accessibilityLabel={labels[type]}
              className={`min-h-[56px] w-[76px] items-center justify-center gap-0.5 rounded-md px-2 py-1 ${
                selected ? "bg-primary" : "border border-border"
              } ${locked ? "" : "active:opacity-70"}`}
            >
              <View>
                <Icon
                  size={24}
                  color={
                    selected ? colors.primaryForeground : colors.foreground
                  }
                />
                {open[type] ? (
                  <View className="absolute -right-2 -top-1 size-3 rounded-full bg-emerald-500" />
                ) : null}
              </View>
              <Text
                className={`text-sm ${
                  selected
                    ? "font-medium text-primary-foreground"
                    : "text-foreground"
                }`}
                numberOfLines={1}
              >
                {labels[type]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
