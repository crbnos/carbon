// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Minus, Plus } from "lucide-react-native";
import { Pressable, TextInput, View } from "react-native";
import { Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { parseQuantity } from "./logic";

/**
 * The quantity every reporting sheet asks for.
 *
 * A decimal keypad plus big −/+ buttons, because both ways of entering a
 * number are needed on a shop floor: a kitter counting out seven of something
 * taps +, an operator reporting 0.75 metres types it.
 *
 * The value is held as a STRING while it is being edited. A number would
 * normalise "1." and "0.0" under the operator's cursor mid-keystroke, and a
 * partially-typed decimal would be rewritten as they typed it. `parseQuantity`
 * is where it becomes a number, once, at submit.
 */

export function QuantityInput({
  value,
  onChange,
  label,
  max,
  autoFocus = false
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Shown as context ("of 40 remaining"); never enforced here. */
  max?: number;
  autoFocus?: boolean;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const current = parseQuantity(value) ?? 0;

  const step = (by: number) => {
    const next = current + by;
    onChange(next > 0 ? String(next) : "");
  };

  return (
    <View className="gap-2">
      <Muted className="text-sm">{label}</Muted>
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => step(-1)}
          disabled={current <= 1}
          accessibilityRole="button"
          accessibilityLabel={t`One less`}
          className={`size-[56px] items-center justify-center rounded-lg border border-border bg-card ${
            current <= 1 ? "opacity-40" : "active:opacity-70"
          }`}
        >
          <Minus size={24} color={colors.foreground} />
        </Pressable>
        <TextInput
          value={value}
          onChangeText={onChange}
          autoFocus={autoFocus}
          keyboardType="decimal-pad"
          selectTextOnFocus
          accessibilityLabel={label}
          placeholder="0"
          placeholderTextColor={colors.mutedForeground}
          className="min-h-[56px] flex-1 rounded-lg border border-input bg-card px-4 text-center text-3xl font-semibold text-foreground"
        />
        <Pressable
          onPress={() => step(1)}
          accessibilityRole="button"
          accessibilityLabel={t`One more`}
          className="size-[56px] items-center justify-center rounded-lg border border-border bg-card active:opacity-70"
        >
          <Plus size={24} color={colors.foreground} />
        </Pressable>
      </View>
      {max !== undefined ? (
        <Muted className="text-sm">{t`${max} remaining`}</Muted>
      ) : null}
    </View>
  );
}
