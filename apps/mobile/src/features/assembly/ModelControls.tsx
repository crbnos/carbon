// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "~/components/useThemeColor";
import { formatClock, indexAtFraction, stepProgress } from "./playback";

/**
 * The player's transport, as web MES has it: previous / play / next, a
 * scrubber over the whole build, the clock, and the scope toggle.
 *
 * Laid over the model rather than under it. The viewport is the entire tab,
 * and a bar below would take a strip out of the only thing worth looking
 * at — which is also where web puts it.
 */

/** What of the model is shown; the three web offers, same names. */
export type ModelScope = "build" | "focus" | "full";

/** The clock ticks in JS, so it is kept slow and local to this component. */
const TICK_MS = 100;

export function ModelControls({
  playing,
  stepIndex,
  stepCount,
  holds,
  starts,
  total,
  /** When the step on screen began playing, for the live clock. */
  stepStartedAt,
  scope,
  onScope,
  onPlayPause,
  onSeek
}: {
  playing: boolean;
  stepIndex: number;
  stepCount: number;
  holds: number[];
  starts: number[];
  total: number;
  stepStartedAt: number;
  scope: ModelScope;
  onScope: (scope: ModelScope) => void;
  onPlayPause: () => void;
  onSeek: (index: number) => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const [elapsedInStep, setElapsedInStep] = useState(0);

  // Ticked here rather than driven from the scene's animation loop: both
  // start from the same step change and run the same duration, so they stay
  // together, and the Filament surface never re-renders for a clock.
  useEffect(() => {
    setElapsedInStep(0);
    if (!playing) return;
    const id = setInterval(
      () => setElapsedInStep(Date.now() - stepStartedAt),
      TICK_MS
    );
    return () => clearInterval(id);
  }, [playing, stepStartedAt]);

  const hold = holds[stepIndex] ?? 0;
  const progress = stepProgress(elapsedInStep, hold);
  const elapsed = (starts[stepIndex] ?? 0) + Math.min(elapsedInStep, hold);

  return (
    <View className="absolute inset-x-0 bottom-0 flex-row items-center gap-3 bg-background/80 px-3 py-2">
      <TransportButton
        label={t`Previous step`}
        disabled={stepIndex <= 0}
        onPress={() => onSeek(stepIndex - 1)}
      >
        <ChevronLeft size={22} color={colors.foreground} />
      </TransportButton>

      <TransportButton
        label={playing ? t`Pause` : t`Play`}
        onPress={onPlayPause}
      >
        {playing ? (
          <Pause size={22} color={colors.foreground} fill={colors.foreground} />
        ) : (
          <Play size={22} color={colors.foreground} fill={colors.foreground} />
        )}
      </TransportButton>

      <TransportButton
        label={t`Next step`}
        disabled={stepIndex >= stepCount - 1}
        onPress={() => onSeek(stepIndex + 1)}
      >
        <ChevronRight size={22} color={colors.foreground} />
      </TransportButton>

      <Scrubber
        holds={holds}
        starts={starts}
        total={total}
        stepIndex={stepIndex}
        progress={progress}
        onSeek={onSeek}
        label={t`Scrub the build`}
      />

      <Text className="font-mono text-xs text-muted-foreground">
        {formatClock(elapsed)} / {formatClock(total)}
      </Text>
      <Text className="font-mono text-xs text-muted-foreground">
        {stepIndex + 1} / {stepCount}
      </Text>

      <View className="flex-row overflow-hidden rounded-md border border-border">
        <ScopeTab
          label={t`Build`}
          selected={scope === "build"}
          onPress={() => onScope("build")}
        />
        <ScopeTab
          label={t`Focus`}
          selected={scope === "focus"}
          onPress={() => onScope("focus")}
        />
        <ScopeTab
          label={t`Full`}
          selected={scope === "full"}
          onPress={() => onScope("full")}
        />
      </View>
    </View>
  );
}

/**
 * The scrubber: one segment per step, each as wide as the step is long.
 *
 * Equal widths would be a lie about the timeline — a step with a long
 * insertion owns more of it — and a tap would then land on the wrong step
 * whenever the durations differ, which is always. `flexGrow` carries the
 * weighting, and `indexAtFraction` reads a tap back out of it with the same
 * arithmetic.
 */
function Scrubber({
  holds,
  starts,
  total,
  stepIndex,
  progress,
  onSeek,
  label
}: {
  holds: number[];
  starts: number[];
  total: number;
  stepIndex: number;
  progress: number;
  onSeek: (index: number) => void;
  label: string;
}) {
  const [width, setWidth] = useState(0);

  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPress={(e) => {
        if (width <= 0) return;
        onSeek(
          indexAtFraction(starts, holds, total, e.nativeEvent.locationX / width)
        );
      }}
      // A 44pt target around a 4pt bar: the bar is what reads at a glance,
      // the target is what a gloved thumb can actually hit.
      className="min-w-0 flex-1 justify-center py-5"
    >
      <View className="flex-row gap-1">
        {holds.map((hold, index) => (
          <View
            // A step's position IS its identity on the timeline, and the
            // list never reorders.
            key={index}
            style={{ flexGrow: Math.max(hold, 1) }}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <View
              className="h-full rounded-full bg-primary"
              style={{
                width:
                  index < stepIndex
                    ? "100%"
                    : index === stepIndex
                      ? `${progress * 100}%`
                      : "0%"
              }}
            />
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function TransportButton({
  label,
  disabled,
  onPress,
  children
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      className={`h-11 w-11 items-center justify-center rounded-full active:opacity-70 ${
        disabled ? "opacity-30" : ""
      }`}
    >
      {children}
    </Pressable>
  );
}

function ScopeTab({
  label,
  selected,
  onPress
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      className={`min-h-[36px] justify-center px-3 ${
        selected ? "bg-primary" : "bg-card"
      }`}
    >
      <Text
        className={`text-xs ${
          selected ? "font-semibold text-primary-foreground" : "text-foreground"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
