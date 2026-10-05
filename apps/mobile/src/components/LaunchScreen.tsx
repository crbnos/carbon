// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";

/**
 * What the app shows while it works out which of the three worlds it is in.
 *
 * It exists because the NATIVE splash is not ours in Expo Go — Expo Go shows
 * its own, and `app.json`'s splash config only applies to a real build. This
 * is the first frame the app itself owns, so it is the one that has to be
 * branded and has to follow the system's light/dark choice. It does both by
 * being an ordinary screen: `bg-background` is the theme token every other
 * screen uses.
 *
 * **The mark arrives, it does not fade in.** The first version lifted it 12px
 * and faded it over 320ms, which is a transition rather than an entrance: on
 * a device it read as a static image that happened to appear. It now scales
 * up THROUGH 1 and settles back, with a ring thrown off behind it — the
 * overshoot is what the eye reads as the thing arriving under its own power,
 * and a linear approach to the final size never does.
 *
 * Still deliberately not a spinner. A spinner says something may be wrong,
 * and this is the normal path on every launch.
 */

export function LaunchScreen() {
  // One driver for the mark, so the scale and the fade cannot drift apart.
  const mark = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(mark, {
          toValue: 1,
          duration: 520,
          // `back` is the overshoot: it carries past the target and returns.
          // Tuned low (1.2) — the default reads as a bounce, and a logo that
          // bounces on every cold start is charming once and irritating by
          // the fifth shift.
          easing: Easing.out(Easing.back(1.2)),
          // The whole animation runs on the UI thread, so a slow first render
          // of the screen behind it cannot make it stutter.
          useNativeDriver: true
        }),
        // The ring leaves slightly later, so it reads as thrown off BY the
        // mark rather than as a second thing arriving beside it.
        Animated.timing(ring, {
          toValue: 1,
          duration: 760,
          delay: 90,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        })
      ]),
      Animated.timing(wordOpacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true
      })
    ]).start();
  }, [mark, ring, wordOpacity]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <View className="items-center justify-center">
        {/*
          The ring: expands past the mark and fades out, which is what gives
          the entrance its sense of force. `pointerEvents` none and absolute,
          so it never affects layout or touch — it is pure decoration over a
          screen that is about to be replaced.
        */}
        <Animated.View
          pointerEvents="none"
          className="absolute h-24 w-24 rounded-full border border-primary"
          style={{
            opacity: ring.interpolate({
              inputRange: [0, 0.35, 1],
              // Up quickly, then away: a ring that fades linearly from full
              // looks like it is being erased rather than dispersing.
              outputRange: [0, 0.35, 0]
            }),
            transform: [
              {
                scale: ring.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.8, 2.1]
                })
              }
            ]
          }}
        />

        <Animated.View
          style={{
            opacity: mark.interpolate({
              inputRange: [0, 0.4, 1],
              // Opaque well before the scale settles, so the overshoot is
              // seen rather than happening behind a fade.
              outputRange: [0, 1, 1]
            }),
            transform: [
              {
                scale: mark.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.4, 1],
                  // `back` drives the value past 1; without this the
                  // interpolation clamps it and the overshoot is lost.
                  extrapolate: "extend"
                })
              }
            ]
          }}
        >
          <Image
            source={require("~/assets/images/splash-icon.png")}
            style={{ width: 96, height: 96 }}
            contentFit="contain"
            // The mark is the same asset the native splash uses, so a real
            // build hands over from one to the other without it jumping.
            accessibilityLabel="Carbon"
          />
        </Animated.View>
      </View>

      <Animated.Text
        style={{
          opacity: wordOpacity,
          transform: [
            {
              translateY: wordOpacity.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0]
              })
            }
          ]
        }}
        className="mt-5 text-base tracking-widest text-muted-foreground"
      >
        <Trans>Carbon MES</Trans>
      </Animated.Text>
    </View>
  );
}
