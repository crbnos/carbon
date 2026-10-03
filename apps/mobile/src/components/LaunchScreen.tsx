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
 * The mark fades and lifts, the wordmark follows it. Deliberately slow enough
 * to read (320ms, then 240ms) and deliberately NOT a spinner: a spinner says
 * "something may be wrong", and this is the normal path on every launch.
 */
export function LaunchScreen() {
  const markOpacity = useRef(new Animated.Value(0)).current;
  const markLift = useRef(new Animated.Value(12)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(markOpacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.quad),
          // The whole animation runs on the UI thread, so a slow first render
          // of the screen behind it cannot make the fade stutter.
          useNativeDriver: true
        }),
        Animated.timing(markLift, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.quad),
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
  }, [markOpacity, markLift, wordOpacity]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Animated.View
        style={{ opacity: markOpacity, transform: [{ translateY: markLift }] }}
      >
        <Image
          source={require("~/assets/images/splash-icon.png")}
          style={{ width: 96, height: 96 }}
          contentFit="contain"
          // The mark is the same asset the native splash uses, so a real build
          // hands over from one to the other without the logo jumping.
          accessibilityLabel="Carbon"
        />
      </Animated.View>

      <Animated.Text
        style={{ opacity: wordOpacity }}
        className="mt-5 text-base tracking-widest text-muted-foreground"
      >
        <Trans>Carbon MES</Trans>
      </Animated.Text>
    </View>
  );
}
