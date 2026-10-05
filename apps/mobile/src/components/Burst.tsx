// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming
} from "react-native-reanimated";
import { DURATION, EASE } from "./motion";
import { burst, type Particle, seededRandom } from "./particles";
import { useThemeColors } from "./useThemeColor";

/**
 * A one-shot particle burst, for the moment a unit or a job is finished.
 *
 * This is the only purely celebratory motion in the app, and it is
 * deliberately rationed to that one event. Everything else here tells an
 * operator something; spending a burst on an ordinary save would make the
 * real one mean nothing.
 *
 * **It never blocks and never catches a touch.** `pointerEvents="none"` and
 * absolute positioning, so the Complete button underneath stays pressable
 * through the whole thing — an operator finishing their fifth unit should
 * not have to wait out a flourish they have already seen four times.
 *
 * Geometry is `burst()`, which is pure and tested. This file only turns
 * those numbers into views, so the thing most likely to be wrong — where
 * the particles go — is checked rather than eyeballed.
 */

/** How long a particle takes to fly out and fade. */
const FLIGHT_MS = 700;

export function Burst({
  /** Changing this fires a new burst; keep it stable to stay quiet. */
  trigger,
  count = 14,
  radius = 110
}: {
  trigger: number;
  count?: number;
  radius?: number;
}) {
  // Seeded FROM the trigger, so two completions in a row differ but either
  // one can be reproduced — and the trigger is a real input to the memo
  // rather than a dependency its body never reads.
  const particles = useMemo(
    () => burst(count, radius, seededRandom(trigger)),
    [count, radius, trigger]
  );

  if (trigger === 0) return null;

  return (
    <View
      pointerEvents="none"
      className="absolute inset-0 items-center justify-center"
    >
      {particles.map((particle, index) => (
        <Fleck
          // Index is the identity here: the list is regenerated whole on
          // every trigger and never reordered within one.
          key={`${trigger}-${index}`}
          particle={particle}
        />
      ))}
    </View>
  );
}

function Fleck({ particle }: { particle: Particle }) {
  const colors = useThemeColors();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      particle.delay,
      withTiming(1, {
        duration: FLIGHT_MS,
        // `out`: fast away, then drifting to a stop. A linear particle
        // looks fired rather than thrown.
        easing: Easing.bezier(...EASE.out)
      })
    );
  }, [progress, particle.delay]);

  const style = useAnimatedStyle(() => ({
    opacity:
      // Full for the first third, then away. Fading from the first frame
      // makes the burst look faint rather than brief.
      progress.value < 0.33 ? 1 : 1 - (progress.value - 0.33) / 0.67,
    transform: [
      { translateX: particle.dx * progress.value },
      { translateY: particle.dy * progress.value },
      { rotate: `${particle.rotation * progress.value}deg` },
      { scale: particle.scale * (1 - progress.value * 0.4) }
    ]
  }));

  return (
    <Animated.View
      style={[
        style,
        {
          position: "absolute",
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: colors.primary
        }
      ]}
    />
  );
}

/** The flight, for a caller that wants to clear state when it is over. */
export const BURST_TOTAL_MS = FLIGHT_MS + DURATION.instant;
