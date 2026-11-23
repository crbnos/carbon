// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  BALLOON_CALLOUT_STROKE,
  clippedBalloonToAnchorLine,
  round
} from "@carbon/utils";
import type { MutableRefObject } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import type {
  AnnotationDraft,
  AnnotationEditDraft,
  AnnotationRecord,
  DragKind,
  FeatureRow,
  PctRect,
  SelectorRect
} from "./editorModel";

const CALLOUT_TEXT = "#171717";

type DrawingOverlayProps = {
  stageRef: MutableRefObject<unknown>;
  /** The page on screen, in pixels. */
  renderedWidth: number;
  overlayHeight: number;
  pdfViewPage: number;
  anchorRects: SelectorRect[];
  annotations: AnnotationRecord[];
  annotationDraft: AnnotationDraft | null;
  annotationEditDraft: AnnotationEditDraft | null;
  featureRows: FeatureRow[];
  selectedSelectorId: string | null;
  selectedAnnotationId: string | null;
  selectedBalloonId: string | null;
  /** The rectangle being dragged out (a selector, annotation or zoom box). */
  previewRect: PctRect | null;
  dragKind: DragKind;
  onMouseDown: (e: unknown) => void;
  onMouseMove: (e: unknown) => void;
  onMouseUp: (e: unknown) => void;
};

/** The selectors, annotations and balloons drawn over the PDF page. */
export default function DrawingOverlay({
  stageRef,
  renderedWidth,
  overlayHeight,
  pdfViewPage,
  anchorRects,
  annotations,
  annotationDraft,
  annotationEditDraft,
  featureRows,
  selectedSelectorId,
  selectedAnnotationId,
  selectedBalloonId,
  previewRect,
  dragKind,
  onMouseDown,
  onMouseMove,
  onMouseUp
}: DrawingOverlayProps) {
  const pageHeightPx = overlayHeight;
  return (
    <Stage
      ref={stageRef as never}
      width={renderedWidth}
      height={overlayHeight}
      listening
      onMouseDown={onMouseDown as never}
      onMouseMove={onMouseMove as never}
      onMouseUp={onMouseUp as never}
    >
      <Layer>
        {anchorRects
          .filter((s) => s.pageNumber === pdfViewPage)
          .map((s) => {
            const x = (s.x / 100) * renderedWidth;
            const y = (s.y / 100) * pageHeightPx;
            const width = (s.width / 100) * renderedWidth;
            const height = (s.height / 100) * pageHeightPx;
            const isSelected = s.id === selectedSelectorId;

            return (
              <Rect
                key={`konva-rect-${s.id}`}
                x={x}
                y={y}
                width={width}
                height={height}
                stroke={BALLOON_CALLOUT_STROKE}
                strokeWidth={isSelected ? 3 : 2}
                fill={isSelected ? "rgba(249,115,22,0.12)" : undefined}
                fillEnabled={isSelected}
                hitStrokeWidth={8}
                listening={false}
              />
            );
          })}
        {annotations
          .filter((a) => a.pageNumber === pdfViewPage)
          .map((annotation) => {
            const x = (annotation.x / 100) * renderedWidth;
            const y = (annotation.y / 100) * pageHeightPx;
            const w = (annotation.width / 100) * renderedWidth;
            const h = (annotation.height / 100) * pageHeightPx;
            const isSelected = annotation.id === selectedAnnotationId;
            const previewText =
              annotationEditDraft?.id === annotation.id
                ? annotationEditDraft.text
                : annotation.text;
            const previewFontSize =
              annotationEditDraft?.id === annotation.id
                ? annotationEditDraft.fontSize
                : annotation.fontSize;

            return (
              <Group key={`annotation-${annotation.id}`} x={x} y={y}>
                <Rect
                  x={0}
                  y={0}
                  width={w}
                  height={h}
                  fill={
                    isSelected
                      ? "rgba(249,115,22,0.22)"
                      : "rgba(249,115,22,0.12)"
                  }
                  stroke={BALLOON_CALLOUT_STROKE}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  cornerRadius={4}
                  listening={false}
                />
                <Text
                  x={8}
                  y={6}
                  width={Math.max(20, w - 16)}
                  height={Math.max(16, h - 12)}
                  text={previewText}
                  fill={CALLOUT_TEXT}
                  fontSize={previewFontSize}
                  listening={false}
                />
              </Group>
            );
          })}
        {annotationDraft &&
          annotationDraft.pageNumber === pdfViewPage &&
          (() => {
            const x = (annotationDraft.x / 100) * renderedWidth;
            const y = (annotationDraft.y / 100) * pageHeightPx;
            const w = (annotationDraft.width / 100) * renderedWidth;
            const h = (annotationDraft.height / 100) * pageHeightPx;

            return (
              <Group key="annotation-draft" x={x} y={y}>
                <Rect
                  x={0}
                  y={0}
                  width={w}
                  height={h}
                  fill="rgba(249,115,22,0.16)"
                  stroke={BALLOON_CALLOUT_STROKE}
                  dash={[4, 4]}
                  strokeWidth={2}
                  cornerRadius={4}
                  listening={false}
                />
                {annotationDraft.text.trim().length > 0 && (
                  <Text
                    x={8}
                    y={6}
                    width={Math.max(20, w - 16)}
                    height={Math.max(16, h - 12)}
                    text={annotationDraft.text}
                    fill={CALLOUT_TEXT}
                    fontSize={annotationDraft.fontSize}
                    listening={false}
                  />
                )}
              </Group>
            );
          })()}
        {featureRows
          .filter((b) => b.pageNumber === pdfViewPage && b.balloonId)
          .map((b) => {
            const balloonWidthPx = (b.width / 100) * renderedWidth;
            const balloonHeightPx = (b.height / 100) * pageHeightPx;
            const balloonX = (b.x / 100) * renderedWidth;
            const balloonY = (b.y / 100) * pageHeightPx;
            const balloonCenterX = balloonX + balloonWidthPx / 2;
            const balloonCenterY = balloonY + balloonHeightPx / 2;
            const radius = Math.max(
              8,
              Math.min(balloonWidthPx, balloonHeightPx) / 2
            );
            const balloonLabelFontSize = Math.max(
              14,
              Math.min(26, round(radius * 1.15, 0))
            );
            const isSelected = b.balloonId === selectedBalloonId;
            const linkedSelector = anchorRects.find(
              (s) => s.id === b.balloonAnchorId
            );
            let linePoints: [number, number, number, number] | null = null;
            if (linkedSelector && linkedSelector.pageNumber === pdfViewPage) {
              const sx = (linkedSelector.x / 100) * renderedWidth;
              const sy = (linkedSelector.y / 100) * pageHeightPx;
              const sw = (linkedSelector.width / 100) * renderedWidth;
              const sh = (linkedSelector.height / 100) * pageHeightPx;
              const anchorX = sx + sw / 2;
              const anchorY = sy + sh / 2;
              linePoints = clippedBalloonToAnchorLine(
                balloonCenterX,
                balloonCenterY,
                radius,
                anchorX,
                anchorY,
                { x: sx, y: sy, w: sw, h: sh }
              );
            }

            return (
              <Group
                key={`balloon-group-${b.balloonId}`}
                x={balloonX}
                y={balloonY}
                listening={false}
              >
                {/* Hit target: children use listening={false}, so without this rect
                    the group receives no pointer events (no hover cursor, no drag). */}
                <Rect
                  x={0}
                  y={0}
                  width={balloonWidthPx}
                  height={balloonHeightPx}
                  fill="rgba(0,0,0,0.001)"
                  listening={false}
                />
                {linePoints && (
                  <Line
                    key={`balloon-line-${b.balloonId}`}
                    points={[
                      linePoints[0] - balloonX,
                      linePoints[1] - balloonY,
                      linePoints[2] - balloonX,
                      linePoints[3] - balloonY
                    ]}
                    stroke={BALLOON_CALLOUT_STROKE}
                    strokeWidth={2}
                    listening={false}
                  />
                )}
                <Circle
                  key={`balloon-circle-${b.balloonId}`}
                  x={balloonWidthPx / 2}
                  y={balloonHeightPx / 2}
                  radius={radius}
                  fill={isSelected ? "rgba(249,115,22,0.14)" : "rgba(0,0,0,0)"}
                  fillEnabled
                  stroke={BALLOON_CALLOUT_STROKE}
                  strokeWidth={isSelected ? 3 : 2}
                  listening={false}
                />
                <Text
                  key={`balloon-text-${b.balloonId}`}
                  x={balloonWidthPx / 2 - radius}
                  y={balloonHeightPx / 2 - radius}
                  width={radius * 2}
                  height={radius * 2}
                  text={b.label}
                  align="center"
                  verticalAlign="middle"
                  fill={BALLOON_CALLOUT_STROKE}
                  fontStyle="bold"
                  fontSize={balloonLabelFontSize}
                  listening={false}
                />
              </Group>
            );
          })}
        {previewRect && (
          <Rect
            x={(previewRect.x / 100) * renderedWidth}
            y={(previewRect.y / 100) * overlayHeight}
            width={(previewRect.width / 100) * renderedWidth}
            height={(previewRect.height / 100) * overlayHeight}
            stroke={dragKind === "zoom" ? "#2563eb" : BALLOON_CALLOUT_STROKE}
            strokeWidth={2}
            fillEnabled={false}
          />
        )}
      </Layer>
    </Stage>
  );
}
