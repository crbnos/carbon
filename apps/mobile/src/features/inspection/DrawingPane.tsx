// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { InspectionBalloon } from "@carbon/mes-core";
import { HEADERS } from "@carbon/mes-core";
import {
  BALLOON_CALLOUT_STROKE,
  BALLOON_H_NORM,
  BALLOON_W_NORM,
  clippedBalloonToAnchorLine
} from "@carbon/utils/balloons";
import { useLingui } from "@lingui/react/macro";
import { Image } from "expo-image";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { Muted, Skeleton } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The inspection drawing, with its balloons.
 *
 * **The page is an image, rendered by the server.** `react-pdf` and
 * `react-konva` — what the web pane is built from — are DOM-only, and every
 * React Native PDF renderer is a native module, which would end Expo Go and
 * put an Apple Developer account between an inspector and a test build. So
 * `GET /inspections/:id/drawing?page=N` rasterises the page and this draws the
 * balloons natively on top.
 *
 * **That is sound because the coordinates are normalized.** Every balloon is
 * stored 0–1 against the page, so the same numbers place a circle correctly
 * over a page rendered at any scale — the geometry comes from
 * `@carbon/utils/balloons`, the same module the web pane and the plan editor
 * use, so all three put a balloon in the same place.
 *
 * The honest cost of an image: no text selection, and no vector zoom past the
 * rendered resolution. The endpoint renders at 3× for that reason, which is
 * enough to pinch a dimension into legibility on a tablet.
 */

/** Matches the endpoint's own default, and what its MAX_SCALE allows. */
const RENDER_SCALE = 3;
const MAX_ZOOM = 6;
const MIN_ZOOM = 1;

export function DrawingPane({
  inspectionId,
  balloons,
  labelByFeatureId,
  activeFeatureId,
  onBalloonPress
}: {
  inspectionId: string;
  balloons: InspectionBalloon[];
  /** The characteristic labels — a balloon's number is its feature's label. */
  labelByFeatureId: Map<string, string>;
  activeFeatureId: string | null;
  onBalloonPress: (inspectionFeatureId: string) => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const { serverUrl, companyId, getAccessToken } = useAuth();

  // Only balloons whose characteristic is still in the plan, as the web pane
  // does: a balloon outlives the deletion of its feature from the document.
  const live = useMemo(
    () => balloons.filter((b) => labelByFeatureId.has(b.inspectionFeatureId)),
    [balloons, labelByFeatureId]
  );

  /**
   * The pages worth showing: the ones carrying characteristics.
   *
   * The wire has no page count on purpose — it would cost a PDF download and
   * parse on every screen load — and a page with no balloons has nothing on it
   * to measure. An inspector who needs the rest of the drawing has it on web
   * or on paper, which is where they read it today.
   */
  const pages = useMemo(() => {
    const numbers = [...new Set(live.map((b) => b.pageNumber))].sort(
      (a, b) => a - b
    );
    return numbers.length > 0 ? numbers : [1];
  }, [live]);

  const [pageIndex, setPageIndex] = useState(0);
  const page = pages[Math.min(pageIndex, pages.length - 1)] ?? 1;

  // The page's own aspect ratio, which is only known once it has loaded. The
  // overlay is sized from the laid-out box, so until then there is nothing to
  // place a balloon against — hence the skeleton rather than a guessed ratio,
  // which would put every balloon in the wrong place for a frame.
  const [ratio, setRatio] = useState<number | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      const next = startScale.value * event.scale;
      scale.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    });

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      // Panning only while zoomed in: at 1× the page already fits, and a
      // draggable page there just slides out from under a thumb aiming at a
      // balloon.
      if (scale.value <= MIN_ZOOM) return;
      translateX.value = startX.value + event.translationX;
      translateY.value = startY.value + event.translationY;
    });

  // Double tap to reset: the only way back from a deep zoom on a page with no
  // edges to pan against.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1);
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
    });

  // `Exclusive` on the double tap so a single tap still reaches a balloon.
  const gesture = Gesture.Exclusive(
    doubleTap,
    Gesture.Simultaneous(pinch, pan)
  );

  const transform = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ]
  }));

  const uri = serverUrl
    ? `${serverUrl}/api/v1/inspections/${inspectionId}/drawing?page=${page}&scale=${RENDER_SCALE}`
    : null;

  // `expo-image` fetches this itself, so it cannot go through the API client —
  // hence the headers by hand. The company header is required: the endpoint
  // takes its tenant from it, exactly as every other call does.
  const token = getAccessToken();
  const source = useMemo(
    () =>
      uri && token && companyId
        ? {
            uri,
            headers: {
              authorization: `Bearer ${token}`,
              [HEADERS.company]: companyId
            }
          }
        : null,
    [uri, token, companyId]
  );

  const pageBalloons = live.filter((b) => b.pageNumber === page);
  const radius = Math.max(10, box.width * 0.012);

  if (!source) {
    return (
      <Muted className="px-4 py-6 text-center text-sm">
        {t`Sign in again to see the drawing.`}
      </Muted>
    );
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between px-4">
        <Muted className="text-sm" numberOfLines={1}>
          {pages.length > 1 ? t`Page ${page} of ${pages.length}` : t`Drawing`}
        </Muted>
        {pages.length > 1 ? (
          <View className="flex-row items-center gap-1">
            <Pressable
              onPress={() => setPageIndex((i) => Math.max(0, i - 1))}
              disabled={pageIndex === 0}
              accessibilityRole="button"
              accessibilityLabel={t`Previous page`}
              className={`size-12 items-center justify-center rounded-lg active:bg-muted ${
                pageIndex === 0 ? "opacity-40" : ""
              }`}
            >
              <ChevronLeft size={22} color={colors.foreground} />
            </Pressable>
            <Pressable
              onPress={() =>
                setPageIndex((i) => Math.min(pages.length - 1, i + 1))
              }
              disabled={pageIndex >= pages.length - 1}
              accessibilityRole="button"
              accessibilityLabel={t`Next page`}
              className={`size-12 items-center justify-center rounded-lg active:bg-muted ${
                pageIndex >= pages.length - 1 ? "opacity-40" : ""
              }`}
            >
              <ChevronRight size={22} color={colors.foreground} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <GestureDetector gesture={gesture}>
        <Animated.View
          style={transform}
          className="overflow-hidden rounded-lg border border-border bg-white"
        >
          <View
            // A drawing is black on white whatever the app's theme is, so the
            // page keeps a white field rather than being inverted in dark mode.
            style={{ aspectRatio: ratio ?? 1.4142 }}
            onLayout={(event) => setBox(event.nativeEvent.layout)}
          >
            <Image
              source={source}
              style={{ width: "100%", height: "100%" }}
              contentFit="contain"
              // Cached by url, which includes the page and the scale, so
              // flipping back to a page already seen costs nothing.
              cachePolicy="disk"
              onLoad={(event) => {
                const { width, height } = event.source;
                if (width > 0 && height > 0) setRatio(width / height);
                setFailed(false);
              }}
              onError={() => setFailed(true)}
            />

            {ratio != null && box.width > 0 && !failed ? (
              <Svg
                style={{ position: "absolute", inset: 0 }}
                width={box.width}
                height={box.height}
              >
                {pageBalloons.map((balloon) => {
                  // Normalized 0–1: the stored point is the top-left of a box
                  // BALLOON_W_NORM x BALLOON_H_NORM whose centre is the circle.
                  const x =
                    (balloon.xCoordinate + BALLOON_W_NORM / 2) * box.width;
                  const y =
                    (balloon.yCoordinate + BALLOON_H_NORM / 2) * box.height;
                  const region = {
                    x: balloon.regionX * box.width,
                    y: balloon.regionY * box.height,
                    w: balloon.regionWidth * box.width,
                    h: balloon.regionHeight * box.height
                  };
                  const leader = clippedBalloonToAnchorLine(
                    x,
                    y,
                    radius,
                    region.x + region.w / 2,
                    region.y + region.h / 2,
                    region
                  );
                  const isActive =
                    balloon.inspectionFeatureId === activeFeatureId;
                  const label =
                    labelByFeatureId.get(balloon.inspectionFeatureId) ?? "";

                  return (
                    <React.Fragment key={balloon.id}>
                      {leader ? (
                        <Line
                          x1={leader[0]}
                          y1={leader[1]}
                          x2={leader[2]}
                          y2={leader[3]}
                          stroke={BALLOON_CALLOUT_STROKE}
                          strokeWidth={2}
                        />
                      ) : null}
                      <Circle
                        cx={x}
                        cy={y}
                        // The circle is the touch target, so it never shrinks
                        // below a thumb even on a page full of balloons.
                        r={Math.max(radius, 14)}
                        stroke={BALLOON_CALLOUT_STROKE}
                        strokeWidth={isActive ? 3 : 2}
                        fill={
                          isActive
                            ? "rgba(249,115,22,0.3)"
                            : "rgba(255,255,255,0.8)"
                        }
                        onPress={() =>
                          onBalloonPress(balloon.inspectionFeatureId)
                        }
                      />
                      <SvgText
                        x={x}
                        y={y + radius * 0.35}
                        textAnchor="middle"
                        fontSize={Math.max(radius, 14)}
                        fontWeight="bold"
                        fill={BALLOON_CALLOUT_STROKE}
                        onPress={() =>
                          onBalloonPress(balloon.inspectionFeatureId)
                        }
                      >
                        {label}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
              </Svg>
            ) : null}

            {ratio == null && !failed ? (
              <Skeleton className="absolute inset-0" />
            ) : null}
          </View>
        </Animated.View>
      </GestureDetector>

      {failed ? (
        <View className="px-4">
          <Text className="text-sm text-muted-foreground">
            {t`The drawing could not be loaded. Pull down to try again.`}
          </Text>
        </View>
      ) : (
        <Muted className="px-4 text-sm">
          {t`Pinch to zoom, double tap to reset. Tap a balloon to jump to its characteristic.`}
        </Muted>
      )}
    </View>
  );
}
