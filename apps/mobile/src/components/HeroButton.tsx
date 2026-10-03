// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useIsTablet } from "./useIsTablet";

/**
 * The one dominant action for the operation's current state: Start when it is
 * stopped, Pause when it is running. Never both, and never two of these on one
 * screen — the design rules allow exactly one.
 *
 * Ported from `apps/mes/app/components/JobOperation/components/Controls.tsx`,
 * including the press: a 4pt darker bottom border that collapses under the
 * thumb (the web's `border-b-4 active:translate-y-1`). On a touch screen with
 * no hover and no cursor, that collapse is the only feedback that the tap
 * registered, and an operator wearing gloves needs it.
 *
 * **Two shapes, one button.** On a tablet it is web's circle — 128pt in the
 * controls column, where there is a column to put it in. On a phone it is a
 * BAR: the same colour, the same icon and word, the same collapsing press, but
 * 56pt tall and as wide as the row allows. The circle was tried on a phone
 * first and it cost more than it was worth: with its label under it the dock
 * stood a quarter of the screen high, and the work the operator came to read
 * was left with a sliver. A wide bar is also the larger target — it is the
 * button someone hits while holding a part in the other hand.
 */

type Tone = "start" | "stop" | "neutral";

const TONES: Record<Tone, { bg: string; border: string }> = {
  // Emerald means go and red means stop, matching web MES exactly. An operator
  // who learned the colour on a browser must not have to relearn it here.
  start: { bg: "bg-emerald-600", border: "border-emerald-800" },
  stop: { bg: "bg-red-600", border: "border-red-800" },
  neutral: { bg: "bg-secondary", border: "border-border" }
};

export function HeroButton({
  icon: Icon,
  label,
  tone,
  onPress,
  disabled = false,
  loading = false,
  /** Shown under the button when `disabled` — never hide a control silently. */
  disabledReason,
  shape
}: {
  icon: LucideIcon;
  label: string;
  tone: Tone;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  disabledReason?: string;
  /** Defaults to the circle on a tablet and the bar on a phone. */
  shape?: "circle" | "bar";
}) {
  const isTablet = useIsTablet();
  const size = 128;
  const inactive = disabled || loading;
  const { bg, border } = TONES[tone];

  if ((shape ?? (isTablet ? "circle" : "bar")) === "bar") {
    return (
      // `flex-1` so it takes whatever the row's other controls leave; the
      // minimum keeps it the widest thing in the dock even beside two of them.
      <View className="min-w-[132px] flex-1 gap-1">
        <Pressable
          onPress={onPress}
          disabled={inactive}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: inactive }}
          accessibilityHint={inactive ? disabledReason : undefined}
          className={`flex-row items-center justify-center gap-2 rounded-xl ${bg} ${border} ${
            inactive ? "opacity-40" : ""
          }`}
          style={({ pressed }) => ({
            height: 56,
            // Same press as the circle: the border collapses under the thumb.
            borderBottomWidth: pressed && !inactive ? 0 : 4,
            transform: [{ translateY: pressed && !inactive ? 4 : 0 }]
          })}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Icon size={24} color="#ffffff" />
          )}
          <Text className="text-lg font-semibold text-white" numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
        {inactive && disabledReason ? (
          <Text className="text-sm text-muted-foreground">
            {disabledReason}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className="items-center gap-2">
      <Pressable
        onPress={onPress}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive }}
        accessibilityHint={inactive ? disabledReason : undefined}
        className={`items-center justify-center rounded-full border-b-4 ${bg} ${border} ${
          inactive ? "opacity-40" : ""
        }`}
        style={({ pressed }) => ({
          width: size,
          height: size,
          // The border collapses rather than the button moving, so the press
          // does not shift what is under the thumb.
          borderBottomWidth: pressed && !inactive ? 0 : 4,
          transform: [{ translateY: pressed && !inactive ? 4 : 0 }]
        })}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" size="large" />
        ) : (
          <Icon size={52} color="#ffffff" />
        )}
      </Pressable>
      <Text className="text-base font-semibold text-foreground">{label}</Text>
      {inactive && disabledReason ? (
        <Text className="max-w-[220px] text-center text-sm text-muted-foreground">
          {disabledReason}
        </Text>
      ) : null}
    </View>
  );
}
