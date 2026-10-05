// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JobOperationSummary } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { DURATION } from "~/components/motion";
import { StatusBadge } from "~/components/StatusBadge";
import { useThemeColors } from "~/components/useThemeColor";
import {
  type Dependency,
  fitTransform,
  type GraphEdge,
  layoutJobGraph,
  NODE_HEIGHT,
  NODE_WIDTH
} from "./graphLayout";

/**
 * The job as a graph — web MES's job DAG, natively.
 *
 * Web builds it with React Flow and Dagre. Both are DOM-only, so the layout
 * is computed here (`jobGraph.ts`, pure and tested) and drawn with the
 * pieces this app already has: `react-native-svg` for the edges, ordinary
 * views for the nodes, and gesture-handler for pan and pinch.
 *
 * **Pan and zoom are the whole point.** A job of twenty-eight operations is
 * wider than any tablet, and without them the graph would be a picture of
 * the first three. One finger drags, a pinch zooms about the point between
 * the fingers, and the graph opens fitted so the first thing an operator
 * sees is the SHAPE of the job.
 *
 * Tapping a node opens that operation, as tapping a node does on web.
 *
 * Gestures run on the UI thread — unlike the 3D viewer's, which have to hop
 * to JS because Filament's manipulator lives there. Here the transform is
 * shared values all the way down, so a drag never waits on React.
 */

type NodeTap = (operationId: string) => void;

export function JobGraph({
  operations,
  dependencies
}: {
  operations: JobOperationSummary[];
  dependencies: Dependency[];
}) {
  const graph = useMemo(
    () => layoutJobGraph(operations, dependencies),
    [operations, dependencies]
  );

  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // What the gesture started from, so a drag is relative rather than
  // snapping the graph to the finger.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const [fitted, setFitted] = useState(false);

  // Fit once the viewport has been measured. During render, not in an
  // effect: an effect would paint one frame of the graph at the wrong scale
  // first, which on a wide job is a flash of the top-left corner.
  if (!fitted && viewport.width > 0 && graph.width > 0) {
    const fit = fitTransform(graph, viewport);
    scale.value = fit.scale;
    translateX.value = fit.x;
    translateY.value = fit.y;
    setFitted(true);
  }

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = startX.value + e.translationX;
      translateY.value = startY.value + e.translationY;
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startScale.value = scale.value;
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      // Clamped: past 4× a node fills the screen and the graph stops being a
      // graph; below 0.2 the nodes are unreadable dashes.
      const next = Math.min(4, Math.max(0.2, startScale.value * e.scale));
      const ratio = next / startScale.value;
      // Zoom about the FOCAL point — the midpoint between the fingers — so
      // the part of the graph being pinched stays under them. Zooming about
      // the origin instead throws the graph off screen on a long job.
      translateX.value = e.focalX - (e.focalX - startX.value) * ratio;
      translateY.value = e.focalY - (e.focalY - startY.value) * ratio;
      scale.value = next;
    });

  const gesture = Gesture.Simultaneous(pan, pinch);

  const surface = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ]
  }));

  const refit = () => {
    const fit = fitTransform(graph, viewport);
    scale.value = withTiming(fit.scale, { duration: DURATION.settle });
    translateX.value = withTiming(fit.x, { duration: DURATION.settle });
    translateY.value = withTiming(fit.y, { duration: DURATION.settle });
  };

  return (
    <View
      className="flex-1 overflow-hidden"
      onLayout={(e) =>
        setViewport({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height
        })
      }
    >
      <GestureDetector gesture={gesture}>
        <View className="flex-1">
          <Animated.View
            style={[
              surface,
              {
                position: "absolute",
                width: graph.width,
                height: graph.height,
                // The transform scales about the centre by default, which
                // fights a translate computed for the top-left.
                transformOrigin: "top left"
              }
            ]}
          >
            <Edges
              edges={graph.edges}
              width={graph.width}
              height={graph.height}
            />
            {graph.nodes.map((node) => (
              <OperationNode
                key={node.operation.id}
                operation={node.operation}
                x={node.x}
                y={node.y}
                onPress={(id) => router.push(`/(app)/operation/${id}` as never)}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>

      <FitButton onPress={refit} />
    </View>
  );
}

/**
 * The dependency edges, as one SVG sized to the whole graph.
 *
 * One `Svg` rather than one per edge: each is a native view, and a job with
 * twenty-seven of them would be twenty-seven surfaces to composite on every
 * pan frame.
 *
 * The curve is a horizontal cubic — the control points sit level with each
 * end — so an edge leaves a node horizontally and arrives horizontally
 * whatever the vertical distance. That is what React Flow's default edge
 * does, and it is what keeps a fan-out readable instead of a bundle of
 * diagonals.
 */
function Edges({
  edges,
  width,
  height
}: {
  edges: GraphEdge[];
  width: number;
  height: number;
}) {
  const colors = useThemeColors();
  if (edges.length === 0) return null;

  return (
    <Svg width={width} height={height} style={{ position: "absolute" }}>
      {edges.map((edge) => {
        const reach = Math.max(40, (edge.x2 - edge.x1) / 2);
        return (
          <Path
            key={`${edge.from}->${edge.to}`}
            d={`M ${edge.x1} ${edge.y1} C ${edge.x1 + reach} ${edge.y1}, ${edge.x2 - reach} ${edge.y2}, ${edge.x2} ${edge.y2}`}
            stroke={colors.border}
            strokeWidth={2}
            fill="none"
          />
        );
      })}
    </Svg>
  );
}

function OperationNode({
  operation,
  x,
  y,
  onPress
}: {
  operation: JobOperationSummary;
  x: number;
  y: number;
  onPress: NodeTap;
}) {
  const { t } = useLingui();
  const complete = operation.quantityComplete ?? 0;
  const target = operation.operationQuantity ?? 0;
  const progress = target > 0 ? Math.min(1, complete / target) : 0;

  return (
    <Pressable
      onPress={() => onPress(operation.id)}
      accessibilityRole="button"
      accessibilityLabel={t`Open operation ${operation.description ?? ""}`}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      }}
      className="justify-between rounded-lg border border-border bg-card p-2.5 active:opacity-70"
    >
      <Text className="text-sm font-semibold text-foreground" numberOfLines={2}>
        {operation.description ?? ""}
      </Text>

      <View className="gap-1.5">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-xs text-muted-foreground">
            {complete} / {target}
          </Text>
          {operation.status ? (
            <StatusBadge entity="jobOperation" status={operation.status} />
          ) : null}
        </View>
        {/* The same bar web puts on a node — the one thing on it readable
            when the graph is zoomed out past the text. */}
        <View className="h-1 overflow-hidden rounded-full bg-muted">
          <View
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress * 100}%` }}
          />
        </View>
      </View>
    </Pressable>
  );
}

/** Web has a Fit button; a pinched-away graph needs a way back. */
function FitButton({ onPress }: { onPress: () => void }) {
  const { t } = useLingui();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t`Fit the graph on screen`}
      className="absolute bottom-4 right-4 min-h-[44px] justify-center rounded-full border border-border bg-card/90 px-4 active:opacity-70"
    >
      <Text className="text-sm text-foreground">{t`Fit`}</Text>
    </Pressable>
  );
}
