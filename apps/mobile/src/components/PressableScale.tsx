// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type ReactNode, useCallback, useState } from "react";
import type { PressableProps } from "react-native";
import { Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from "react-native-reanimated";
import { pressScale, SPRING } from "./motion";

/**
 * A Pressable that acknowledges the press by shrinking slightly.
 *
 * This is the highest-reach piece of motion in the app: it is on every
 * button, card and dock action, and it is the difference between a control
 * that responds and one that waits for the network before admitting the tap
 * landed. On a shop floor that gap is not cosmetic — an operator who is not
 * sure a tap registered taps again, and a second tap on Complete is a
 * second unit.
 *
 * **A spring, not a timing.** A press has no duration; the finger decides.
 * Lifting half way through resolves from where the control actually is
 * rather than jumping to the end and back, which is the case `withTiming`
 * gets wrong.
 *
 * **It always returns to rest.** `onPressOut` fires for a cancelled press
 * and a completed one alike, so no path leaves a control shrunk.
 *
 * **The scale comes from the measured width** (`pressScale`), so a 48pt
 * button and a 320pt card both move their edge the same ~1.5pt. A fixed
 * factor makes the card lurch while the button barely moves.
 *
 * **Why the styling is on an inner `Animated.View`.** `className` is only
 * honoured on components Uniwind patches, and
 * `Animated.createAnimatedComponent(Pressable)` makes a bespoke one — the
 * prop would be dropped in silence, which is how every screen in this app
 * once rendered into a zero-height box. `Animated.View` IS patched
 * (`ActionDock` has relied on it since it was written), so the Pressable
 * stays bare for the touch and the view carries the look and the transform.
 *
 * One consequence for callers: an `active:` class on the passed className
 * will NOT fire, because the pressed state belongs to the Pressable and the
 * class is on the view inside it. That is the point — the scale replaces
 * `active:opacity-*`, so drop it rather than stacking both.
 */
export function PressableScale({
  children,
  className,
  disabled,
  ...props
}: Omit<PressableProps, "children"> & {
  children: ReactNode;
  className?: string;
}) {
  const scale = useSharedValue(1);
  // 0 until the first layout pass; `pressScale` returns 1 for that, so an
  // early press is a no-op rather than a scale by NaN, which blanks the view.
  const [width, setWidth] = useState(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  const onPressIn = useCallback(() => {
    scale.value = withSpring(pressScale(width), SPRING.snappy);
  }, [scale, width]);

  const onPressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING.snappy);
  }, [scale]);

  return (
    <Pressable
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={disabled ? undefined : onPressOut}
      disabled={disabled}
      {...props}
    >
      <Animated.View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={animatedStyle}
        className={className}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
