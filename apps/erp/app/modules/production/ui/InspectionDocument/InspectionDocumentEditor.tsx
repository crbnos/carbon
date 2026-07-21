import { useCarbon } from "@carbon/auth";
import {
  Button,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
  useDebounce,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { Database } from "@carbon/database";
import type { ColumnDef } from "@tanstack/react-table";
import {
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuChevronUp,
  LuFileDown,
  LuLoader,
  LuMinus,
  LuPlus,
  LuRectangleHorizontal,
  LuSave,
  LuTrash2,
  LuUpload
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import { EditableList, EditableText } from "~/components/Editable";
import Grid from "~/components/Grid";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { useUser } from "~/hooks";
import type { BalloonRegionAnalysis } from "~/modules/quality/inspectionBalloonAnalyze";
import type { InspectionDocumentContent } from "~/modules/quality/types";
import { procedureStepType } from "~/modules/shared/shared.models";
import { path } from "~/utils/path";
import { cropInspectionAnchorToPngBlob } from "./cropInspectionAnchorToPng";
import { buildInspectionDocumentPdfWithOverlaysBytes } from "./exportInspectionDocumentPdfWithOverlays";

type DragState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
} | null;
type DragKind =
  | "anchor"
  | "zoom"
  | "annotation"
  | "annotationResize"
  | "balloonMove"
  | "anchorResize"
  | null;

type SelectorResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type AnnotationRecord = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
};

type AnnotationDraft = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
};

type AnnotationEditDraft = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
};

type InspectionDocumentEditorProps = {
  diagramId: string;
  name: string;
  content: InspectionDocumentContent | null;
  features: Array<Record<string, unknown>>;
  balloons: Array<Record<string, unknown>>;
  unitOfMeasures: Array<{ code: string; name: string }>;
};

type PdfMetrics = {
  pageCount: number;
  defaultPageWidth: number;
  defaultPageHeight: number;
};

function toPercent(px: number, total: number) {
  return (px / total) * 100;
}

const EDITOR_SPLITTER_H = 8;
const MIN_PDF_PANE_PX = 160;
const ANNOTATION_DIALOG_WIDTH_PX = 220;
const ANNOTATION_DIALOG_HEIGHT_PX = 140;
const ANNOTATION_DIALOG_GAP_PX = 8;
const SELECTOR_RESIZE_HANDLE_PX = 10;
const SELECTOR_MIN_SIZE_PX = 12;
const ANNOTATION_RESIZE_HANDLE_PX = 10;
const ANNOTATION_MIN_SIZE_PX = 12;

/** When the features table is expanded it keeps at least half the editor stack; PDF height is capped accordingly. */
function clampPdfPaneHeight(
  pdfPx: number,
  stackH: number,
  featuresExpanded: boolean
): number {
  if (!featuresExpanded || stackH <= EDITOR_SPLITTER_H + MIN_PDF_PANE_PX) {
    return Math.max(MIN_PDF_PANE_PX, pdfPx);
  }
  const minFeatures = stackH * 0.5;
  const maxPdf = Math.max(
    MIN_PDF_PANE_PX,
    stackH - EDITOR_SPLITTER_H - minFeatures
  );
  return Math.min(maxPdf, Math.max(MIN_PDF_PANE_PX, pdfPx));
}

function getAnnotationDialogPosition(args: {
  renderedWidth: number;
  overlayHeight: number;
  totalPagesStage: number;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const {
    renderedWidth,
    overlayHeight,
    totalPagesStage,
    pageNumber,
    x,
    y,
    width,
    height
  } = args;

  const annLeft = (x / 100) * renderedWidth;
  const annTop =
    ((pageNumber - 1) / totalPagesStage) * overlayHeight +
    (y / 100) * (overlayHeight / totalPagesStage);
  const annWidth = (width / 100) * renderedWidth;
  const annHeight = (height / 100) * (overlayHeight / totalPagesStage);
  const annRight = annLeft + annWidth;
  const annBottom = annTop + annHeight;

  const maxLeft = Math.max(8, renderedWidth - ANNOTATION_DIALOG_WIDTH_PX);
  const maxTop = Math.max(8, overlayHeight - ANNOTATION_DIALOG_HEIGHT_PX);

  const rightCandidate = annRight + ANNOTATION_DIALOG_GAP_PX;
  const leftCandidate =
    annLeft - ANNOTATION_DIALOG_WIDTH_PX - ANNOTATION_DIALOG_GAP_PX;

  let left = rightCandidate;
  if (rightCandidate <= maxLeft) {
    left = rightCandidate;
  } else if (leftCandidate >= 8) {
    left = leftCandidate;
  } else {
    left = Math.max(8, Math.min(maxLeft, rightCandidate));
  }

  let top = Math.max(8, Math.min(maxTop, annTop));

  const dialogRight = left + ANNOTATION_DIALOG_WIDTH_PX;
  const dialogBottom = top + ANNOTATION_DIALOG_HEIGHT_PX;
  const overlapsAnnotation =
    left < annRight &&
    dialogRight > annLeft &&
    top < annBottom &&
    dialogBottom > annTop;

  if (overlapsAnnotation) {
    const belowCandidate = annBottom + ANNOTATION_DIALOG_GAP_PX;
    const aboveCandidate =
      annTop - ANNOTATION_DIALOG_HEIGHT_PX - ANNOTATION_DIALOG_GAP_PX;
    if (belowCandidate <= maxTop) {
      top = belowCandidate;
    } else if (aboveCandidate >= 8) {
      top = aboveCandidate;
    } else {
      top = Math.max(8, Math.min(maxTop, belowCandidate));
    }
  }

  return { left, top };
}

function cursorForSelectorResizeHandle(
  handle: SelectorResizeHandle
): "ew-resize" | "ns-resize" | "nwse-resize" | "nesw-resize" | "pointer" {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    default:
      return "pointer";
  }
}

/** Callout / anchor stroke — matches reference (orange border, hollow fill). */
const CALLOUT_STROKE = "#f97316";
const CALLOUT_TEXT = "#171717";

/**
 * Konva 9 does not apply the `cursor` prop to the DOM; Transformer only sets
 * `stage.content.style.cursor` manually. Use these helpers for hover/drag cursors.
 */
function konvaContentFromStageRef(stageRef: {
  current: unknown;
}): HTMLElement | null {
  const st = stageRef.current as { content?: HTMLElement } | null | undefined;
  return st?.content ?? null;
}

/** Liang–Barsky: clip segment (x0,y0)→(x1,y1) to axis-aligned rect; returns [0,1] params or null. */
function liangBarskySegmentRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { u0: number; u1: number } | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let u0 = 0;
  let u1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        u0 = Math.max(u0, r);
      } else {
        u1 = Math.min(u1, r);
      }
      if (u0 > u1) return null;
    }
  }
  return { u0, u1 };
}

/**
 * Visible connector from balloon edge → toward anchor, stopping before the anchor rect interior.
 * u is linear param from B (0) to A (1); balloon occupies u ∈ [0, r/L).
 */
function clippedBalloonToAnchorLine(
  bx: number,
  by: number,
  radiusPx: number,
  ax: number,
  ay: number,
  rect: { x: number; y: number; w: number; h: number }
): [number, number, number, number] | null {
  const L = Math.hypot(ax - bx, ay - by);
  if (L < 1e-6) return null;
  const epsU = Math.max(1e-4, 2 / L);
  const uBalloonExit = Math.min(1 - epsU, radiusPx / L + epsU);
  const { x, y, w, h } = rect;
  const hit = liangBarskySegmentRect(bx, by, ax, ay, x, y, x + w, y + h);
  let uEnd = 1 - epsU;
  if (hit) {
    const uEnter = Math.max(0, Math.min(1, hit.u0));
    if (uEnter > uBalloonExit) {
      uEnd = Math.min(uEnd, uEnter - epsU);
    }
  }
  if (uEnd <= uBalloonExit + 1e-4) return null;
  const x0 = bx + (ax - bx) * uBalloonExit;
  const y0 = by + (ay - by) * uBalloonExit;
  const x1 = bx + (ax - bx) * uEnd;
  const y1 = by + (ay - by) * uEnd;
  return [x0, y0, x1, y1];
}

type SelectorRect = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew: boolean;
  isDirty: boolean;
};

/** One grid row = one inspectionFeature; optional balloon for drawing overlay. */
type FeatureRow = {
  featureId: string;
  balloonId: string | null;
  balloonAnchorId: string;
  label: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Maps to inspectionFeature.description (editable "Description" column). */
  featureName: string;
  nominalValue: string;
  tolerancePlus: string;
  toleranceMinus: string;
  units: string;
  type: (typeof procedureStepType)[number];
  featureDirty?: boolean;
  geometryDirty?: boolean;
};

const featureTypeOptions = procedureStepType.map((t) => ({
  label: t,
  value: t
}));

type FeatureMutationFn = (
  accessorKey: string,
  newValue: string,
  row: FeatureRow
) => Promise<{
  data: null;
  error: null;
  count: null;
  status: number;
  statusText: string;
}>;

const ConditionalMeasurementText =
  (baseMutation: FeatureMutationFn) =>
  (props: EditableTableCellComponentProps<FeatureRow>) => {
    if (props.row.type !== "Measurement") {
      return <span className="text-muted-foreground text-sm">&mdash;</span>;
    }
    return EditableText(baseMutation)(props);
  };

const ConditionalMeasurementList =
  (
    baseMutation: FeatureMutationFn,
    options: { label: string; value: string }[]
  ) =>
  (props: EditableTableCellComponentProps<FeatureRow>) => {
    if (props.row.type !== "Measurement") {
      return <span className="text-muted-foreground text-sm">&mdash;</span>;
    }
    return EditableList(baseMutation, options)(props);
  };

const BALLOON_W_NORM = 0.04;
const BALLOON_H_NORM = 0.04;
const BALLOON_OFFSET_NORM = 0.02;
const BALLOON_W_PCT = BALLOON_W_NORM * 100;
const BALLOON_H_PCT = BALLOON_H_NORM * 100;
const BALLOON_OFFSET_PCT = BALLOON_OFFSET_NORM * 100;

function nextBalloonLabel(rows: FeatureRow[]): string {
  const nums = rows
    .map((r) => parseInt(r.label, 10))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return String(max + 1);
}

function isTempFeatureId(featureId: string) {
  return featureId.startsWith("temp-ftr-");
}

function isTempBalloonId(balloonId: string | null) {
  return balloonId != null && balloonId.startsWith("temp-bln-");
}

function stripBalloonGeometryFromFeatureRows(rows: FeatureRow[]): FeatureRow[] {
  return rows.map((r) =>
    r.balloonId == null
      ? r
      : {
          ...r,
          balloonId: null,
          balloonAnchorId: "",
          x: 0,
          y: 0,
          geometryDirty: false
        }
  );
}

function hasBalloonGeometry(
  rows: FeatureRow[],
  selectors: SelectorRect[]
): boolean {
  return rows.some((r) => r.balloonId != null) || selectors.length > 0;
}

function sanitizeFilenameBase(name: string) {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]+/g, "_");
  return (trimmed.length > 0 ? trimmed : "diagram").slice(0, 120);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getBalloonValueOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function blobToBase64Data(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Selector regions are always derived from balloon rows (region = anchor rect). */
function selectorRectsFromBalloonRecords(
  balloons: Array<Record<string, unknown>>
): SelectorRect[] {
  return balloons.map((b) => ({
    id: String(b.id),
    pageNumber: Number(b.pageNumber ?? 1),
    x: Number(b.regionX ?? b.xCoordinate ?? 0) * 100,
    y: Number(b.regionY ?? b.yCoordinate ?? 0) * 100,
    width: Number(b.regionWidth ?? 0.1) * 100,
    height: Number(b.regionHeight ?? 0.1) * 100,
    isNew: false,
    isDirty: false
  }));
}

/** When a balloon exists, its page is authoritative for overlay placement. */
function resolvedFeaturePageNumber(
  feature: Record<string, unknown>,
  balloon?: Record<string, unknown>
): number {
  if (
    balloon != null &&
    balloon.pageNumber != null &&
    balloon.pageNumber !== ""
  ) {
    return Number(balloon.pageNumber);
  }
  return Number(feature.pageNumber ?? 1);
}

function mapFeatureRowFromRecords(
  feature: Record<string, unknown>,
  balloon?: Record<string, unknown>
): FeatureRow {
  const desc =
    feature.description != null && String(feature.description).trim() !== ""
      ? String(feature.description)
      : "";
  const label = String(feature.label ?? "");
  const featureName = desc || `Feature ${label}`;
  const balloonId =
    balloon != null
      ? String(balloon.id)
      : feature.balloonId != null
        ? String(feature.balloonId)
        : null;

  return {
    featureId: String(feature.id),
    balloonId,
    balloonAnchorId: balloonId ?? "",
    label,
    pageNumber: resolvedFeaturePageNumber(feature, balloon),
    x: balloon ? Number(balloon.xCoordinate ?? 0) * 100 : 0,
    y: balloon ? Number(balloon.yCoordinate ?? 0) * 100 : 0,
    width: BALLOON_W_PCT,
    height: BALLOON_H_PCT,
    featureName,
    nominalValue: String(feature.nominalValue ?? ""),
    tolerancePlus: String(feature.tolerancePlus ?? ""),
    toleranceMinus: String(feature.toleranceMinus ?? ""),
    units: String(feature.unit ?? ""),
    type: (feature.type as (typeof procedureStepType)[number]) ?? "Measurement",
    featureDirty: false,
    geometryDirty: false
  };
}

function buildFeatureRowsFromLoader(
  features: Array<Record<string, unknown>>,
  balloons: Array<Record<string, unknown>>
) {
  const balloonByFeatureId = new Map(
    balloons.map((b) => [String(b.inspectionFeatureId), b])
  );
  return features.map((f) =>
    mapFeatureRowFromRecords(
      f,
      f.balloonId != null
        ? balloons.find((b) => String(b.id) === String(f.balloonId))
        : balloonByFeatureId.get(String(f.id))
    )
  );
}

export default function InspectionDocumentEditor({
  diagramId,
  name,
  content,
  features: initialFeatures,
  balloons,
  unitOfMeasures
}: InspectionDocumentEditorProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<{
    success: boolean;
    message?: string;
    featureIdMap?: Record<string, string>;
    balloonAnchorIdMap?: Record<string, string>;
    features?: Array<Record<string, unknown>>;
    anchors?: Array<Record<string, unknown>>;
    balloons?: Array<Record<string, unknown>>;
  }>();
  const nameFetcher = useFetcher();
  const [title, setTitle] = useState(name);
  const debouncedSaveName = useDebounce((value: string) => {
    nameFetcher.submit(
      { drawingNumber: value },
      {
        method: "post",
        action: path.to.updateInspectionDocumentName(diagramId)
      }
    );
  }, 500);

  const { carbon } = useCarbon();
  const user = useUser();
  const companyId = user.company.id;

  const [pdfUrl, setPdfUrl] = useState<string>(content?.pdfUrl ?? "");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [replacePdfConfirmOpen, setReplacePdfConfirmOpen] = useState(false);
  const [pendingReplacePdfFile, setPendingReplacePdfFile] =
    useState<File | null>(null);

  useEffect(() => {
    const documentPresent = pdfFile !== null || pdfUrl.trim() !== "";
    setFeaturesTableExpanded(!documentPresent);
  }, [pdfFile, pdfUrl]);
  const [anchorRects, setSelectorRects] = useState<SelectorRect[]>(() =>
    selectorRectsFromBalloonRecords(balloons)
  );
  const [featureRows, setFeatureRows] = useState<FeatureRow[]>(() =>
    buildFeatureRowsFromLoader(initialFeatures, balloons)
  );
  const [placing, setPlacing] = useState(false);
  const [placingAnnotation, setPlacingAnnotation] = useState(false);
  const [zoomBoxMode, setZoomBoxMode] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [numPages, setNumPages] = useState<number>(0);
  /** 1-based page index for the PDF viewer (one page on screen at a time). */
  const [pdfViewPage, setPdfViewPage] = useState(1);
  const [pdfMetrics, setPdfMetrics] = useState<PdfMetrics | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [drag, setDrag] = useState<DragState>(null);
  const [dragKind, setDragKind] = useState<DragKind>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [overlayHeight, setOverlayHeight] = useState<number>(0);
  /** Expanded when no PDF (edit features); collapsed when a document is loaded (room for drawing). */
  const [featuresTableExpanded, setFeaturesTableExpanded] = useState(
    () => !(content?.pdfUrl ?? "").trim()
  );
  /** Height of PDF block when table is expanded (px); drag the splitter to adjust. */
  const [pdfPaneHeightPx, setPdfPaneHeightPx] = useState(360);
  const [editorStackHeightPx, setEditorStackHeightPx] = useState(0);
  const [isResizingPdfFeatures, setIsResizingPdfFeatures] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfPageRendered, setPdfPageRendered] = useState(false);
  const prevPdfViewPageRef = useRef(pdfViewPage);
  if (prevPdfViewPageRef.current !== pdfViewPage) {
    prevPdfViewPageRef.current = pdfViewPage;
    setPdfPageRendered(false);
  }
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<unknown>(null);
  const editorStackRef = useRef<HTMLDivElement>(null);
  const balloonDragRef = useRef<{
    balloonId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const anchorResizeRef = useRef<{
    balloonAnchorId: string;
    handle: SelectorResizeHandle;
    startRect: Pick<SelectorRect, "x" | "y" | "width" | "height">;
  } | null>(null);
  const annotationResizeRef = useRef<{
    annotationId: string;
    handle: SelectorResizeHandle;
    startRect: Pick<
      AnnotationRecord,
      "x" | "y" | "width" | "height" | "pageNumber"
    >;
  } | null>(null);
  const splitDragRef = useRef<{ startY: number; startPdfPx: number } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Only the explicit Save button should show "Diagram saved" — not auto-persist after anchor draw. */
  const manualSaveToastRef = useRef(false);
  const pdfReplaceToastRef = useRef(false);
  const pdfReplacePendingMetricsRef = useRef(false);
  /** Persisted feature ids to hard-delete on next Save. */
  const pendingFeatureDeleteIdsRef = useRef(new Set<string>());
  /** Persisted balloon ids to hard-delete on next Save (unballoon). */
  const pendingBalloonDeleteIdsRef = useRef(new Set<string>());
  const [placingFeatureId, setPlacingFeatureId] = useState<string | null>(null);

  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(null);
  const [selectedBalloonId, setSelectedBalloonId] = useState<string | null>(
    null
  );
  const [selectedSelectorId, setSelectedSelectorId] = useState<string | null>(
    null
  );
  const [annotationDraft, setAnnotationDraft] =
    useState<AnnotationDraft | null>(null);
  const [annotationFontSizeInput, setAnnotationFontSizeInput] =
    useState<string>("12");
  const [annotationEditDraft, setAnnotationEditDraft] =
    useState<AnnotationEditDraft | null>(null);
  const [annotationEditFontSizeInput, setAnnotationEditFontSizeInput] =
    useState<string>("12");

  const documentPageCount = Math.max(1, numPages, pdfMetrics?.pageCount ?? 0);

  useEffect(() => {
    setPdfViewPage((p) =>
      Math.min(Math.max(1, p), Math.max(1, pdfMetrics?.pageCount ?? numPages))
    );
  }, [pdfMetrics?.pageCount, numPages]);

  useEffect(() => {
    void pdfViewPage;
    containerRef.current?.scrollTo(0, 0);
  }, [pdfViewPage]);

  useEffect(() => {
    setSelectedSelectorId((id) => {
      if (!id) return null;
      const sel = anchorRects.find((s) => s.id === id);
      if (!sel || sel.pageNumber !== pdfViewPage) return null;
      return id;
    });
    setSelectedBalloonId((bid) => {
      if (!bid) return null;
      const row = featureRows.find((r) => r.balloonId === bid);
      if (!row || row.pageNumber !== pdfViewPage) return null;
      return bid;
    });
    setSelectedAnnotationId((aid) => {
      if (!aid) return null;
      const ann = annotations.find((a) => a.id === aid);
      if (!ann || ann.pageNumber !== pdfViewPage) return null;
      return aid;
    });
  }, [pdfViewPage, anchorRects, featureRows, annotations]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!editorStackRef.current) return;
    const el = editorStackRef.current;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      setEditorStackHeightPx(h);
      setPdfPaneHeightPx((prev) =>
        clampPdfPaneHeight(prev, h, featuresTableExpanded)
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [featuresTableExpanded]);

  useEffect(() => {
    if (!isResizingPdfFeatures) return;
    const onMove = (e: MouseEvent) => {
      const start = splitDragRef.current;
      if (!start) return;
      const dy = e.clientY - start.startY;
      setPdfPaneHeightPx(
        clampPdfPaneHeight(
          start.startPdfPx + dy,
          editorStackHeightPx,
          featuresTableExpanded
        )
      );
    };
    const onUp = () => {
      setIsResizingPdfFeatures(false);
      splitDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizingPdfFeatures, editorStackHeightPx, featuresTableExpanded]);

  const onSplitResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!featuresTableExpanded) return;
      e.preventDefault();
      splitDragRef.current = {
        startY: e.clientY,
        startPdfPx: pdfPaneHeightPx
      };
      setIsResizingPdfFeatures(true);
    },
    [featuresTableExpanded, pdfPaneHeightPx]
  );

  // Measure container width and keep it up to date on resize
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const hasPdfSource = pdfFile !== null || pdfUrl !== "";
    if (!hasPdfSource || !overlayRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setOverlayHeight(h);
    });
    ro.observe(overlayRef.current);
    return () => ro.disconnect();
  }, [pdfFile, pdfUrl]);

  useEffect(() => {
    if (!pdfReplacePendingMetricsRef.current || !pdfMetrics) return;
    pdfReplacePendingMetricsRef.current = false;
    const formData = new FormData();
    formData.set("pageCount", String(pdfMetrics.pageCount));
    formData.set("defaultPageWidth", String(pdfMetrics.defaultPageWidth));
    formData.set("defaultPageHeight", String(pdfMetrics.defaultPageHeight));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.saveInspectionDocument(diagramId)
    });
  }, [diagramId, fetcher, pdfMetrics]);

  useEffect(() => {
    if (fetcher.data?.success === true) {
      const savedBalloons = fetcher.data.balloons ?? [];
      setSelectorRects(selectorRectsFromBalloonRecords(savedBalloons));
      setFeatureRows(
        buildFeatureRowsFromLoader(fetcher.data.features ?? [], savedBalloons)
      );
      pendingFeatureDeleteIdsRef.current.clear();
      pendingBalloonDeleteIdsRef.current.clear();
      if (pdfReplaceToastRef.current) {
        toast.success(
          t`Drawing replaced. Balloon placements were removed; feature rows are unchanged.`
        );
        pdfReplaceToastRef.current = false;
      } else if (manualSaveToastRef.current) {
        toast.success(t`Diagram saved`);
        manualSaveToastRef.current = false;
      }
    } else if (fetcher.data?.success === false) {
      pdfReplaceToastRef.current = false;
      pdfReplacePendingMetricsRef.current = false;
      manualSaveToastRef.current = false;
      toast.error(fetcher.data.message ?? t`Failed to save diagram`);
    }
  }, [fetcher.data, t]);

  const loadAnnotations = useCallback(async () => {
    setAnnotations([]);
  }, []);

  useEffect(() => {
    void loadAnnotations();
  }, [loadAnnotations]);

  useEffect(() => {
    if (!selectedAnnotationId || annotationDraft) {
      setAnnotationEditDraft(null);
      return;
    }
    const selected = annotations.find(
      (item) => item.id === selectedAnnotationId
    );
    if (!selected) {
      setAnnotationEditDraft(null);
      return;
    }
    setAnnotationEditDraft({
      id: selected.id,
      pageNumber: selected.pageNumber,
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
      text: selected.text,
      fontSize: selected.fontSize
    });
    setAnnotationEditFontSizeInput(String(selected.fontSize));
  }, [selectedAnnotationId, annotations, annotationDraft]);

  const getRelativePosFromStage = useCallback(() => {
    const stage = stageRef.current as {
      getPointerPosition: () => { x: number; y: number } | null;
      width: () => number;
      height: () => number;
    } | null;
    const pos = stage?.getPointerPosition?.() ?? null;
    if (!pos || !stage) return { x: 0, y: 0 };
    const w = stage.width();
    const h = stage.height();
    return { x: toPercent(pos.x, w), y: toPercent(pos.y, h) };
  }, []);

  const persistAnnotationResize = useCallback(
    async (_annotation: AnnotationRecord) => {
      return;
    },
    []
  );

  const finalizeDragAt = useCallback(
    (x: number, y: number) => {
      if (!drag || !dragKind) return;

      const rx = Math.min(drag.startX, x);
      const ry = Math.min(drag.startY, y);
      const rw = Math.abs(x - drag.startX);
      const rh = Math.abs(y - drag.startY);

      if (rw < 0.5 || rh < 0.5) {
        if (dragKind === "balloonMove") {
          balloonDragRef.current = null;
        }
        if (dragKind === "annotationResize") {
          annotationResizeRef.current = null;
        }
        if (dragKind === "anchorResize") {
          anchorResizeRef.current = null;
        }
        setDragKind(null);
        setDrag(null);
        return;
      }

      if (dragKind === "zoom") {
        if (!containerRef.current || !overlayRef.current) {
          setDragKind(null);
          setDrag(null);
          return;
        }
        const overlayRect = overlayRef.current.getBoundingClientRect();
        const boxWidthPx = (rw / 100) * overlayRect.width;
        const boxHeightPx = (rh / 100) * overlayRect.height;
        if (boxWidthPx < 8 || boxHeightPx < 8) {
          setDragKind(null);
          setDrag(null);
          return;
        }
        const fitX = containerRef.current.clientWidth / boxWidthPx;
        const fitY = containerRef.current.clientHeight / boxHeightPx;
        const nextZoom = Math.max(
          0.5,
          Math.min(3, Number((zoomScale * Math.min(fitX, fitY)).toFixed(2)))
        );
        const zoomRatio = nextZoom / zoomScale;
        const centerXPx = ((rx + rw / 2) / 100) * overlayRect.width;
        const centerYPx = ((ry + rh / 2) / 100) * overlayHeight;
        setZoomScale(nextZoom);
        requestAnimationFrame(() => {
          if (!containerRef.current) return;
          containerRef.current.scrollLeft =
            centerXPx * zoomRatio - containerRef.current.clientWidth / 2;
          containerRef.current.scrollTop =
            centerYPx * zoomRatio - containerRef.current.clientHeight / 2;
        });
        setDragKind(null);
        setDrag(null);
        return;
      }

      if (dragKind === "annotation") {
        const pageNumber = pdfViewPage;
        const localY = ry;
        const localHeight = rh;
        const clippedLocalHeight = Math.min(localHeight, 100 - localY);

        if (clippedLocalHeight < 0.5) {
          setDragKind(null);
          setDrag(null);
          return;
        }

        setAnnotationDraft({
          pageNumber,
          x: rx,
          y: localY,
          width: rw,
          height: clippedLocalHeight,
          text: "",
          fontSize: 12
        });
        setAnnotationFontSizeInput("12");
        setDragKind(null);
        setDrag(null);
        setPlacingAnnotation(false);
        return;
      }

      if (dragKind === "annotationResize" && annotationResizeRef.current) {
        const activeResize = annotationResizeRef.current;
        const stageWidthPctBase = Math.max(1, containerWidth * zoomScale);
        const pageHeightPx = overlayHeight;
        const minWidthPct = Math.max(
          0.5,
          (ANNOTATION_MIN_SIZE_PX / stageWidthPctBase) * 100
        );
        const minHeightPct = Math.max(
          0.5,
          (ANNOTATION_MIN_SIZE_PX / Math.max(1, pageHeightPx)) * 100
        );
        const start = activeResize.startRect;
        const deltaX = x - drag.startX;
        const deltaY = y - drag.startY;
        let nextX = start.x;
        let nextY = start.y;
        let nextW = start.width;
        let nextH = start.height;

        if (activeResize.handle.includes("e")) {
          nextW = Math.max(
            minWidthPct,
            Math.min(100 - start.x, start.width + deltaX)
          );
        }
        if (activeResize.handle.includes("s")) {
          nextH = Math.max(
            minHeightPct,
            Math.min(100 - start.y, start.height + deltaY)
          );
        }
        if (activeResize.handle.includes("w")) {
          const limitedX = Math.max(
            0,
            Math.min(start.x + start.width - minWidthPct, start.x + deltaX)
          );
          nextX = limitedX;
          nextW = start.width - (limitedX - start.x);
        }
        if (activeResize.handle.includes("n")) {
          const limitedY = Math.max(
            0,
            Math.min(start.y + start.height - minHeightPct, start.y + deltaY)
          );
          nextY = limitedY;
          nextH = start.height - (limitedY - start.y);
        }

        const resized = {
          x: Math.max(0, Math.min(100 - nextW, nextX)),
          y: Math.max(0, Math.min(100 - nextH, nextY)),
          width: nextW,
          height: nextH
        };

        const finalAnnotation: AnnotationRecord = {
          id: activeResize.annotationId,
          pageNumber: start.pageNumber,
          ...resized,
          text:
            annotations.find((item) => item.id === activeResize.annotationId)
              ?.text ?? "",
          fontSize:
            annotations.find((item) => item.id === activeResize.annotationId)
              ?.fontSize ?? 12
        };

        setAnnotations((prev) =>
          prev.map((a) =>
            a.id === activeResize.annotationId ? { ...a, ...resized } : a
          )
        );
        setAnnotationEditDraft((prev) =>
          prev && prev.id === activeResize.annotationId
            ? { ...prev, ...resized }
            : prev
        );
        annotationResizeRef.current = null;
        setDragKind(null);
        setDrag(null);
        void persistAnnotationResize(finalAnnotation);
        return;
      }

      if (dragKind === "anchor") {
        const pageNumber = pdfViewPage;
        const localY = ry;
        const localHeight = rh;
        const clippedLocalHeight = Math.min(localHeight, 100 - localY);

        if (clippedLocalHeight < 0.5) {
          setDragKind(null);
          setDrag(null);
          return;
        }

        const placingExistingFeatureId = placingFeatureId;
        const tempBalloonId = `temp-bln-${nanoid()}`;
        let balloonX = rx + rw + BALLOON_OFFSET_PCT;
        if (balloonX + BALLOON_W_PCT > 100) {
          balloonX = rx - BALLOON_OFFSET_PCT - BALLOON_W_PCT;
        }
        balloonX = Math.max(0, Math.min(100 - BALLOON_W_PCT, balloonX));
        const balloonY = Math.max(0, Math.min(100 - BALLOON_H_PCT, localY));

        setSelectorRects((prev) => [
          ...prev,
          {
            id: tempBalloonId,
            pageNumber,
            x: rx,
            y: localY,
            width: rw,
            height: clippedLocalHeight,
            isNew: true,
            isDirty: false
          }
        ]);

        setFeatureRows((prev) => {
          const existing = placingExistingFeatureId
            ? prev.find((r) => r.featureId === placingExistingFeatureId)
            : null;
          if (existing) {
            return prev.map((r) =>
              r.featureId !== placingExistingFeatureId
                ? r
                : {
                    ...r,
                    balloonId: tempBalloonId,
                    balloonAnchorId: tempBalloonId,
                    pageNumber,
                    x: balloonX,
                    y: balloonY,
                    featureDirty: isTempFeatureId(r.featureId)
                      ? r.featureDirty
                      : true,
                    geometryDirty: true
                  }
            );
          }
          const tempFeatureId = `temp-ftr-${nanoid()}`;
          const label = nextBalloonLabel(prev);
          return [
            ...prev,
            {
              featureId: tempFeatureId,
              balloonId: tempBalloonId,
              balloonAnchorId: tempBalloonId,
              label,
              pageNumber,
              x: balloonX,
              y: balloonY,
              width: BALLOON_W_PCT,
              height: BALLOON_H_PCT,
              featureName: `Feature ${label}`,
              nominalValue: "",
              tolerancePlus: "",
              toleranceMinus: "",
              units: "",
              type: "Measurement"
            }
          ];
        });
        setPlacingFeatureId(null);

        // New selector rows only — skip AI when placing geometry on an existing table feature.
        if (!placingExistingFeatureId) {
          const renderedPageWidthPx = Math.max(1, containerWidth * zoomScale);
          void (async () => {
            try {
              if (pdfFile === null && !pdfUrl) {
                return;
              }
              let bytes: ArrayBuffer;
              if (pdfFile !== null) {
                bytes = await pdfFile.arrayBuffer();
              } else {
                const res = await fetch(pdfUrl, { credentials: "include" });
                if (!res.ok) {
                  throw new Error(String(res.status));
                }
                bytes = await res.arrayBuffer();
              }
              const blob = await cropInspectionAnchorToPngBlob({
                pdfBytes: bytes,
                pageNumber,
                x: rx,
                y: localY,
                width: rw,
                height: clippedLocalHeight,
                renderedPageWidthPx
              });

              try {
                const imageBase64 = await blobToBase64Data(blob);
                const analyzeRes = await fetch(
                  path.to.api.inspectionDocumentBalloonAnalyze(diagramId),
                  {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      imageBase64,
                      mediaType: "image/png"
                    })
                  }
                );
                const payloadUnknown: unknown = await analyzeRes.json();
                const payload = payloadUnknown as {
                  success?: boolean;
                  analysis?: BalloonRegionAnalysis;
                  message?: string;
                };
                if (!analyzeRes.ok || !payload.success || !payload.analysis) {
                  toast.error(
                    t`Could not analyze region: ${payload.message ?? analyzeRes.statusText}`
                  );
                  return;
                }
                const a = payload.analysis;
                setFeatureRows((prev) =>
                  prev.map((r) => {
                    if (r.balloonId !== tempBalloonId) return r;
                    const fmt = (n: number | null, fallback: string) =>
                      n != null && Number.isFinite(n) ? String(n) : fallback;
                    const nextNominal = fmt(a.nominal, r.nominalValue);
                    const nextPlus = fmt(a.tol_plus, r.tolerancePlus);
                    const nextMinus = fmt(a.tol_minus, r.toleranceMinus);
                    const nextUnits = a.unit != null ? a.unit : r.units;
                    let nextFeatureName = r.featureName;
                    if (a.type !== "unknown") {
                      const tag = ` [${a.type}]`;
                      if (!nextFeatureName.includes(tag)) {
                        nextFeatureName = `${nextFeatureName}${tag}`;
                      }
                    }
                    return {
                      ...r,
                      nominalValue: nextNominal,
                      tolerancePlus: nextPlus,
                      toleranceMinus: nextMinus,
                      units: nextUnits,
                      type: "Measurement",
                      featureName: nextFeatureName,
                      featureDirty: true
                    };
                  })
                );
                toast.success(t`Feature values suggested from drawing`);
              } catch {
                toast.error(t`Could not analyze cropped region`);
              }
            } catch {
              toast.error(t`Could not prepare region image for analysis`);
            }
          })();
        }

        setDragKind(null);
        setDrag(null);
        setPlacing(false);
        return;
      }

      if (dragKind === "balloonMove") {
        balloonDragRef.current = null;
        setDragKind(null);
        setDrag(null);
        return;
      }

      if (dragKind === "anchorResize") {
        anchorResizeRef.current = null;
        setDragKind(null);
        setDrag(null);
        return;
      }

      setDragKind(null);
      setDrag(null);
    },
    [
      drag,
      pdfViewPage,
      dragKind,
      zoomScale,
      overlayHeight,
      containerWidth,
      pdfFile,
      pdfUrl,
      diagramId,
      annotations,
      persistAnnotationResize,
      placingFeatureId,
      t
    ]
  );

  const getAnnotationIdAt = useCallback(
    (x: number, y: number): string | null => {
      const pageNumber = pdfViewPage;
      const localY = y;

      for (let i = annotations.length - 1; i >= 0; i -= 1) {
        const annotation = annotations[i];
        if (annotation.pageNumber !== pageNumber) continue;
        const inRect =
          x >= annotation.x &&
          x <= annotation.x + annotation.width &&
          localY >= annotation.y &&
          localY <= annotation.y + annotation.height;
        if (inRect) return annotation.id;
      }

      return null;
    },
    [annotations, pdfViewPage]
  );

  const getAnnotationResizeHandleAt = useCallback(
    (
      x: number,
      y: number
    ): { annotationId: string; handle: SelectorResizeHandle } | null => {
      const pageNumber = pdfViewPage;
      const localY = y;
      const pageHeightPx = overlayHeight;
      const stageWidthPctBase = Math.max(1, containerWidth * zoomScale);
      const hPad = Math.max(
        0.5,
        (ANNOTATION_RESIZE_HANDLE_PX / stageWidthPctBase) * 100
      );
      const vPad = Math.max(
        0.5,
        (ANNOTATION_RESIZE_HANDLE_PX / Math.max(1, pageHeightPx)) * 100
      );

      for (let i = annotations.length - 1; i >= 0; i -= 1) {
        const a = annotations[i];
        if (a.pageNumber !== pageNumber) continue;
        const left = a.x;
        const right = a.x + a.width;
        const top = a.y;
        const bottom = a.y + a.height;
        const nearLeft = Math.abs(x - left) <= hPad;
        const nearRight = Math.abs(x - right) <= hPad;
        const nearTop = Math.abs(localY - top) <= vPad;
        const nearBottom = Math.abs(localY - bottom) <= vPad;
        const withinXBand = x >= left - hPad && x <= right + hPad;
        const withinYBand = localY >= top - vPad && localY <= bottom + vPad;
        if (!withinXBand || !withinYBand) continue;

        if (nearTop && nearLeft) return { annotationId: a.id, handle: "nw" };
        if (nearTop && nearRight) return { annotationId: a.id, handle: "ne" };
        if (nearBottom && nearLeft) return { annotationId: a.id, handle: "sw" };
        if (nearBottom && nearRight)
          return { annotationId: a.id, handle: "se" };
        if (nearTop) return { annotationId: a.id, handle: "n" };
        if (nearBottom) return { annotationId: a.id, handle: "s" };
        if (nearLeft) return { annotationId: a.id, handle: "w" };
        if (nearRight) return { annotationId: a.id, handle: "e" };
      }

      return null;
    },
    [annotations, pdfViewPage, overlayHeight, containerWidth, zoomScale]
  );

  const getBalloonIdAt = useCallback(
    (x: number, y: number): string | null => {
      const pageNumber = pdfViewPage;
      const localY = y;

      for (let i = featureRows.length - 1; i >= 0; i -= 1) {
        const balloon = featureRows[i];
        if (balloon.pageNumber !== pageNumber) continue;
        const inRect =
          x >= balloon.x &&
          x <= balloon.x + balloon.width &&
          localY >= balloon.y &&
          localY <= balloon.y + balloon.height;
        if (inRect && balloon.balloonId) return balloon.balloonId;
      }

      return null;
    },
    [featureRows, pdfViewPage]
  );

  const getSelectorIdAt = useCallback(
    (x: number, y: number): string | null => {
      const pageNumber = pdfViewPage;
      const localY = y;

      for (let i = anchorRects.length - 1; i >= 0; i -= 1) {
        const anchor = anchorRects[i];
        if (anchor.pageNumber !== pageNumber) continue;
        const inRect =
          x >= anchor.x &&
          x <= anchor.x + anchor.width &&
          localY >= anchor.y &&
          localY <= anchor.y + anchor.height;
        if (inRect) return anchor.id;
      }

      return null;
    },
    [anchorRects, pdfViewPage]
  );

  const getSelectorResizeHandleAt = useCallback(
    (
      x: number,
      y: number
    ): { balloonAnchorId: string; handle: SelectorResizeHandle } | null => {
      const pageNumber = pdfViewPage;
      const localY = y;

      const pageHeightPx = overlayHeight;
      const stageWidthPctBase = Math.max(1, containerWidth * zoomScale);
      const hPad = Math.max(
        0.5,
        (SELECTOR_RESIZE_HANDLE_PX / stageWidthPctBase) * 100
      );
      const vPad = Math.max(
        0.5,
        (SELECTOR_RESIZE_HANDLE_PX / Math.max(1, pageHeightPx)) * 100
      );

      for (let i = anchorRects.length - 1; i >= 0; i -= 1) {
        const s = anchorRects[i];
        if (s.pageNumber !== pageNumber) continue;

        const left = s.x;
        const right = s.x + s.width;
        const top = s.y;
        const bottom = s.y + s.height;

        const nearLeft = Math.abs(x - left) <= hPad;
        const nearRight = Math.abs(x - right) <= hPad;
        const nearTop = Math.abs(localY - top) <= vPad;
        const nearBottom = Math.abs(localY - bottom) <= vPad;

        const withinXBand = x >= left - hPad && x <= right + hPad;
        const withinYBand = localY >= top - vPad && localY <= bottom + vPad;
        if (!withinXBand || !withinYBand) continue;

        if (nearTop && nearLeft) return { balloonAnchorId: s.id, handle: "nw" };
        if (nearTop && nearRight)
          return { balloonAnchorId: s.id, handle: "ne" };
        if (nearBottom && nearLeft)
          return { balloonAnchorId: s.id, handle: "sw" };
        if (nearBottom && nearRight)
          return { balloonAnchorId: s.id, handle: "se" };
        if (nearTop) return { balloonAnchorId: s.id, handle: "n" };
        if (nearBottom) return { balloonAnchorId: s.id, handle: "s" };
        if (nearLeft) return { balloonAnchorId: s.id, handle: "w" };
        if (nearRight) return { balloonAnchorId: s.id, handle: "e" };
      }

      return null;
    },
    [anchorRects, pdfViewPage, overlayHeight, containerWidth, zoomScale]
  );

  const handleStageMouseDown = useCallback(
    (e: unknown) => {
      const ke = e as {
        evt?: MouseEvent;
        target?: unknown;
        cancelBubble?: boolean;
        getTarget?: () => unknown;
      };
      const evt = ke.evt;
      if (!evt) return;

      if (placing) {
        evt.preventDefault();
        const { x, y } = getRelativePosFromStage();
        setDragKind("anchor");
        setDrag({ startX: x, startY: y, currentX: x, currentY: y });
        return;
      }

      if (placingAnnotation) {
        evt.preventDefault();
        const { x, y } = getRelativePosFromStage();
        setDragKind("annotation");
        setDrag({ startX: x, startY: y, currentX: x, currentY: y });
        return;
      }

      if (zoomBoxMode) {
        evt.preventDefault();
        const { x, y } = getRelativePosFromStage();
        setDragKind("zoom");
        setDrag({ startX: x, startY: y, currentX: x, currentY: y });
        return;
      }

      const { x, y } = getRelativePosFromStage();
      const annotationId = getAnnotationIdAt(x, y);
      const annotationResize = getAnnotationResizeHandleAt(x, y);
      if (annotationResize) {
        const annotation = annotations.find(
          (a) => a.id === annotationResize.annotationId
        );
        if (annotation) {
          setSelectedAnnotationId(annotation.id);
          setSelectedBalloonId(null);
          setSelectedSelectorId(null);
          annotationResizeRef.current = {
            annotationId: annotation.id,
            handle: annotationResize.handle,
            startRect: {
              x: annotation.x,
              y: annotation.y,
              width: annotation.width,
              height: annotation.height,
              pageNumber: annotation.pageNumber
            }
          };
          evt.preventDefault();
          setDragKind("annotationResize");
          setDrag({ startX: x, startY: y, currentX: x, currentY: y });
          return;
        }
      }

      if (annotationId) {
        setSelectedAnnotationId(annotationId);
        setSelectedBalloonId(null);
        setSelectedSelectorId(null);
        return;
      }

      const anchorResize = getSelectorResizeHandleAt(x, y);
      if (anchorResize) {
        const anchor = anchorRects.find(
          (s) => s.id === anchorResize.balloonAnchorId
        );
        if (anchor) {
          const linkedBalloonId =
            featureRows.find((row) => row.balloonAnchorId === anchor.id)
              ?.balloonId ?? null;
          setSelectedSelectorId(anchor.id);
          setSelectedBalloonId(linkedBalloonId);
          setSelectedAnnotationId(null);
          anchorResizeRef.current = {
            balloonAnchorId: anchor.id,
            handle: anchorResize.handle,
            startRect: {
              x: anchor.x,
              y: anchor.y,
              width: anchor.width,
              height: anchor.height
            }
          };
          evt.preventDefault();
          setDragKind("anchorResize");
          setDrag({ startX: x, startY: y, currentX: x, currentY: y });
          return;
        }
      }

      const balloonId = getBalloonIdAt(x, y);
      if (balloonId) {
        const linkedSelectorId =
          featureRows.find((row) => row.balloonId === balloonId)
            ?.balloonAnchorId ?? null;
        setSelectedBalloonId(balloonId);
        setSelectedAnnotationId(null);
        setSelectedSelectorId(linkedSelectorId);
        const dragged = featureRows.find((row) => row.balloonId === balloonId);
        if (dragged) {
          evt.preventDefault();
          balloonDragRef.current = {
            balloonId,
            startX: dragged.x,
            startY: dragged.y
          };
          setDragKind("balloonMove");
          setDrag({ startX: x, startY: y, currentX: x, currentY: y });
        }
        return;
      }

      const balloonAnchorId = getSelectorIdAt(x, y);
      if (balloonAnchorId) {
        const linkedBalloonId =
          featureRows.find((row) => row.balloonAnchorId === balloonAnchorId)
            ?.balloonId ?? null;
        setSelectedSelectorId(balloonAnchorId);
        setSelectedAnnotationId(null);
        setSelectedBalloonId(linkedBalloonId);
        return;
      }

      setSelectedAnnotationId(null);
      setSelectedBalloonId(null);
      setSelectedSelectorId(null);
    },
    [
      placingAnnotation,
      placing,
      getRelativePosFromStage,
      zoomBoxMode,
      getAnnotationIdAt,
      getAnnotationResizeHandleAt,
      getSelectorResizeHandleAt,
      getBalloonIdAt,
      getSelectorIdAt,
      annotations,
      featureRows,
      anchorRects
    ]
  );

  const handleCreateAnnotation = useCallback(async () => {
    if (!annotationDraft || annotationDraft.text.trim().length === 0) {
      toast.error(t`Annotation text is required`);
      return;
    }
    const next: AnnotationRecord = {
      id: `temp-ann-${Date.now()}`,
      pageNumber: annotationDraft.pageNumber,
      x: annotationDraft.x,
      y: annotationDraft.y,
      width: annotationDraft.width,
      height: annotationDraft.height,
      text: annotationDraft.text.trim(),
      fontSize: annotationDraft.fontSize
    };
    setAnnotations((prev) => [...prev, next]);
    setAnnotationDraft(null);
    setAnnotationFontSizeInput("12");
    toast.success(t`Annotation added`);
  }, [annotationDraft, t]);

  const handleUpdateAnnotation = useCallback(async () => {
    if (!annotationEditDraft || annotationEditDraft.text.trim().length === 0) {
      toast.error(t`Annotation text is required`);
      return;
    }
    const updated: AnnotationRecord = {
      ...annotationEditDraft,
      text: annotationEditDraft.text.trim()
    };
    setAnnotations((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    setSelectedAnnotationId(null);
    setAnnotationEditDraft(null);
    toast.success(t`Annotation updated`);
  }, [annotationEditDraft, t]);

  const handleDeleteAnnotation = useCallback(async () => {
    if (!annotationEditDraft) return;
    setAnnotations((prev) =>
      prev.filter((item) => item.id !== annotationEditDraft.id)
    );
    setSelectedAnnotationId(null);
    setAnnotationEditDraft(null);
    toast.success(t`Annotation deleted`);
  }, [annotationEditDraft, t]);

  const getHoverCursorAt = useCallback(
    (
      x: number,
      y: number
    ):
      | ""
      | "pointer"
      | "ew-resize"
      | "ns-resize"
      | "nwse-resize"
      | "nesw-resize" => {
      const pageNumber = pdfViewPage;
      const localY = y;

      const inRect = (
        left: number,
        top: number,
        width: number,
        height: number
      ) =>
        x >= left &&
        x <= left + width &&
        localY >= top &&
        localY <= top + height;

      // Top-most visual priority: annotation -> balloon -> anchor.
      const annotationResize = getAnnotationResizeHandleAt(x, y);
      if (annotationResize) {
        return cursorForSelectorResizeHandle(annotationResize.handle);
      }

      for (const annotation of annotations) {
        if (annotation.pageNumber !== pageNumber) continue;
        if (
          inRect(
            annotation.x,
            annotation.y,
            annotation.width,
            annotation.height
          )
        ) {
          return "pointer";
        }
      }

      for (const balloon of featureRows) {
        if (balloon.pageNumber !== pageNumber || !balloon.balloonId) continue;
        if (inRect(balloon.x, balloon.y, balloon.width, balloon.height)) {
          return "pointer";
        }
      }

      const anchorResize = getSelectorResizeHandleAt(x, y);
      if (anchorResize) {
        return cursorForSelectorResizeHandle(anchorResize.handle);
      }

      for (const anchor of anchorRects) {
        if (anchor.pageNumber !== pageNumber) continue;
        if (inRect(anchor.x, anchor.y, anchor.width, anchor.height)) {
          return "pointer";
        }
      }

      return "";
    },
    [
      annotations,
      featureRows,
      anchorRects,
      pdfViewPage,
      getAnnotationResizeHandleAt,
      getSelectorResizeHandleAt
    ]
  );

  const handleStageMouseMove = useCallback(
    (e: unknown) => {
      const evt = (e as { evt?: MouseEvent }).evt;
      if (!evt) return;

      const { x, y } = getRelativePosFromStage();

      const stageContent = konvaContentFromStageRef(stageRef);
      if (placing || placingAnnotation || zoomBoxMode || drag) {
        if (stageContent) {
          if (dragKind === "balloonMove") {
            stageContent.style.cursor = "grabbing";
          } else if (
            dragKind === "annotationResize" &&
            annotationResizeRef.current
          ) {
            stageContent.style.cursor = cursorForSelectorResizeHandle(
              annotationResizeRef.current.handle
            );
          } else if (dragKind === "anchorResize" && anchorResizeRef.current) {
            stageContent.style.cursor = cursorForSelectorResizeHandle(
              anchorResizeRef.current.handle
            );
          } else {
            stageContent.style.cursor = "";
          }
        }
      } else if (stageContent) {
        stageContent.style.cursor = getHoverCursorAt(x, y);
      }

      if (dragKind === "balloonMove" && drag && balloonDragRef.current) {
        const activeDrag = balloonDragRef.current;
        const deltaX = x - drag.startX;
        const deltaY = y - drag.startY;
        setFeatureRows((prev) =>
          prev.map((row) => {
            if (row.balloonId !== activeDrag.balloonId) return row;
            const nextX = Math.max(
              0,
              Math.min(100 - row.width, activeDrag.startX + deltaX)
            );
            const nextY = Math.max(
              0,
              Math.min(100 - row.height, activeDrag.startY + deltaY)
            );
            return {
              ...row,
              x: nextX,
              y: nextY,
              geometryDirty: isTempBalloonId(row.balloonId)
                ? row.geometryDirty
                : true
            };
          })
        );
      }

      if (
        dragKind === "annotationResize" &&
        drag &&
        annotationResizeRef.current
      ) {
        const activeResize = annotationResizeRef.current;
        const pageHeightPx = overlayHeight;
        const stageWidthPctBase = Math.max(1, containerWidth * zoomScale);
        const minWidthPct = Math.max(
          0.5,
          (ANNOTATION_MIN_SIZE_PX / stageWidthPctBase) * 100
        );
        const minHeightPct = Math.max(
          0.5,
          (ANNOTATION_MIN_SIZE_PX / Math.max(1, pageHeightPx)) * 100
        );
        const start = activeResize.startRect;
        const deltaX = x - drag.startX;
        const deltaY = y - drag.startY;
        let nextX = start.x;
        let nextY = start.y;
        let nextW = start.width;
        let nextH = start.height;

        if (activeResize.handle.includes("e")) {
          nextW = Math.max(
            minWidthPct,
            Math.min(100 - start.x, start.width + deltaX)
          );
        }
        if (activeResize.handle.includes("s")) {
          nextH = Math.max(
            minHeightPct,
            Math.min(100 - start.y, start.height + deltaY)
          );
        }
        if (activeResize.handle.includes("w")) {
          const limitedX = Math.max(
            0,
            Math.min(start.x + start.width - minWidthPct, start.x + deltaX)
          );
          nextX = limitedX;
          nextW = start.width - (limitedX - start.x);
        }
        if (activeResize.handle.includes("n")) {
          const limitedY = Math.max(
            0,
            Math.min(start.y + start.height - minHeightPct, start.y + deltaY)
          );
          nextY = limitedY;
          nextH = start.height - (limitedY - start.y);
        }

        const resized = {
          x: Math.max(0, Math.min(100 - nextW, nextX)),
          y: Math.max(0, Math.min(100 - nextH, nextY)),
          width: nextW,
          height: nextH
        };

        setAnnotations((prev) =>
          prev.map((a) =>
            a.id === activeResize.annotationId ? { ...a, ...resized } : a
          )
        );
        setAnnotationEditDraft((prev) =>
          prev && prev.id === activeResize.annotationId
            ? { ...prev, ...resized }
            : prev
        );
      }

      if (dragKind === "anchorResize" && drag && anchorResizeRef.current) {
        const activeResize = anchorResizeRef.current;
        const deltaX = x - drag.startX;
        const deltaY = y - drag.startY;
        const pageHeightPx = overlayHeight;
        const stageWidthPctBase = Math.max(1, containerWidth * zoomScale);
        const minWidthPct = Math.max(
          0.5,
          (SELECTOR_MIN_SIZE_PX / stageWidthPctBase) * 100
        );
        const minHeightPct = Math.max(
          0.5,
          (SELECTOR_MIN_SIZE_PX / Math.max(1, pageHeightPx)) * 100
        );
        const start = activeResize.startRect;
        let nextX = start.x;
        let nextY = start.y;
        let nextW = start.width;
        let nextH = start.height;

        if (activeResize.handle.includes("e")) {
          nextW = Math.max(
            minWidthPct,
            Math.min(100 - start.x, start.width + deltaX)
          );
        }
        if (activeResize.handle.includes("s")) {
          nextH = Math.max(
            minHeightPct,
            Math.min(100 - start.y, start.height + deltaY)
          );
        }
        if (activeResize.handle.includes("w")) {
          const limitedX = Math.max(
            0,
            Math.min(start.x + start.width - minWidthPct, start.x + deltaX)
          );
          nextX = limitedX;
          nextW = start.width - (limitedX - start.x);
        }
        if (activeResize.handle.includes("n")) {
          const limitedY = Math.max(
            0,
            Math.min(start.y + start.height - minHeightPct, start.y + deltaY)
          );
          nextY = limitedY;
          nextH = start.height - (limitedY - start.y);
        }

        const resizedRect = {
          x: Math.max(0, Math.min(100 - nextW, nextX)),
          y: Math.max(0, Math.min(100 - nextH, nextY)),
          width: nextW,
          height: nextH
        };

        setSelectorRects((prev) =>
          prev.map((anchor) =>
            anchor.id !== activeResize.balloonAnchorId
              ? anchor
              : { ...anchor, ...resizedRect, isDirty: true }
          )
        );

        setFeatureRows((prev) =>
          prev.map((row) =>
            row.balloonAnchorId !== activeResize.balloonAnchorId
              ? row
              : {
                  ...row,
                  geometryDirty: isTempBalloonId(row.balloonId)
                    ? row.geometryDirty
                    : true
                }
          )
        );
      }

      if (!drag) return;
      setDrag((d) => (d ? { ...d, currentX: x, currentY: y } : null));
    },
    [
      drag,
      dragKind,
      getRelativePosFromStage,
      getHoverCursorAt,
      placing,
      placingAnnotation,
      zoomBoxMode,
      overlayHeight,
      containerWidth,
      zoomScale
    ]
  );

  const handleStageMouseUp = useCallback(
    (e: unknown) => {
      const evt = (e as { evt?: MouseEvent }).evt;
      if (!evt) return;

      if (!drag || !dragKind) return;

      const { x, y } = getRelativePosFromStage();
      finalizeDragAt(x, y);
    },
    [drag, dragKind, getRelativePosFromStage, finalizeDragAt]
  );

  const handleSave = useCallback(() => {
    manualSaveToastRef.current = true;
    const formData = new FormData();
    formData.set("name", name);
    if (pdfUrl) formData.set("pdfUrl", pdfUrl);
    const featuresCreate = featureRows
      .filter((r) => isTempFeatureId(r.featureId))
      .map((r) => ({
        tempId: r.featureId,
        pageNumber: r.pageNumber,
        label: r.label,
        description: r.featureName.trim() || null,
        nominalValue: getBalloonValueOrNull(r.nominalValue),
        tolerancePlus: getBalloonValueOrNull(r.tolerancePlus),
        toleranceMinus: getBalloonValueOrNull(r.toleranceMinus),
        unit: getBalloonValueOrNull(r.units),
        type: r.type
      }));

    const featuresUpdate = featureRows
      .filter(
        (r) =>
          !isTempFeatureId(r.featureId) &&
          (r.featureDirty || (r.geometryDirty && r.balloonId != null))
      )
      .map((r) => ({
        id: r.featureId,
        pageNumber: r.pageNumber,
        label: r.label,
        description: r.featureName.trim() || null,
        nominalValue: getBalloonValueOrNull(r.nominalValue),
        tolerancePlus: getBalloonValueOrNull(r.tolerancePlus),
        toleranceMinus: getBalloonValueOrNull(r.toleranceMinus),
        unit: getBalloonValueOrNull(r.units),
        type: r.type
      }));

    formData.set(
      "features",
      JSON.stringify({
        create: featuresCreate,
        update: featuresUpdate,
        delete: [...pendingFeatureDeleteIdsRef.current]
      })
    );

    const balloonsCreate = featureRows
      .filter((r) => isTempBalloonId(r.balloonId))
      .map((r) => {
        const anchor = anchorRects.find((s) => s.id === r.balloonAnchorId);
        return {
          ...(isTempFeatureId(r.featureId)
            ? { tempInspectionFeatureId: r.featureId }
            : { inspectionFeatureId: r.featureId }),
          tempBalloonAnchorId: r.balloonId ?? undefined,
          pageNumber: r.pageNumber,
          regionX: (anchor?.x ?? 0) / 100,
          regionY: (anchor?.y ?? 0) / 100,
          regionWidth: (anchor?.width ?? BALLOON_W_PCT) / 100,
          regionHeight: (anchor?.height ?? BALLOON_H_PCT) / 100,
          xCoordinate: r.x / 100,
          yCoordinate: r.y / 100
        };
      });

    const balloonsUpdateById = new Map<
      string,
      {
        id: string;
        pageNumber?: number;
        regionX?: number;
        regionY?: number;
        regionWidth?: number;
        regionHeight?: number;
        xCoordinate?: number;
        yCoordinate?: number;
      }
    >();

    for (const anchor of anchorRects.filter((s) => !s.isNew && s.isDirty)) {
      balloonsUpdateById.set(anchor.id, {
        id: anchor.id,
        pageNumber: anchor.pageNumber,
        regionX: anchor.x / 100,
        regionY: anchor.y / 100,
        regionWidth: anchor.width / 100,
        regionHeight: anchor.height / 100
      });
    }

    for (const row of featureRows.filter(
      (r) => r.balloonId && !isTempBalloonId(r.balloonId) && r.geometryDirty
    )) {
      const anchor = anchorRects.find((s) => s.id === row.balloonAnchorId);
      const existing = balloonsUpdateById.get(row.balloonId!) ?? {
        id: row.balloonId!
      };
      balloonsUpdateById.set(row.balloonId!, {
        ...existing,
        pageNumber: anchor?.pageNumber ?? row.pageNumber,
        ...(anchor
          ? {
              regionX: anchor.x / 100,
              regionY: anchor.y / 100,
              regionWidth: anchor.width / 100,
              regionHeight: anchor.height / 100
            }
          : {}),
        xCoordinate: row.x / 100,
        yCoordinate: row.y / 100
      });
    }

    formData.set(
      "balloons",
      JSON.stringify({
        create: balloonsCreate,
        update: [...balloonsUpdateById.values()],
        delete: [...pendingBalloonDeleteIdsRef.current]
      })
    );

    if (pdfMetrics) {
      formData.set("pageCount", String(pdfMetrics.pageCount));
      formData.set("defaultPageWidth", String(pdfMetrics.defaultPageWidth));
      formData.set("defaultPageHeight", String(pdfMetrics.defaultPageHeight));
    }
    fetcher.submit(formData, {
      method: "post",
      action: path.to.saveInspectionDocument(diagramId)
    });
  }, [diagramId, name, pdfUrl, anchorRects, featureRows, pdfMetrics, fetcher]);

  const uploadPdfAndSave = useCallback(
    async (file: File, options: { clearBalloons: boolean }) => {
      if (!carbon) return;

      setUploading(true);

      const storagePath = `${companyId}/inspectionDocument/${diagramId}/${nanoid()}.pdf`;
      const result = await carbon.storage
        .from("private")
        .upload(storagePath, file);

      setUploading(false);

      if (result.error) {
        toast.error(t`Failed to upload PDF`);
        return;
      }

      const nextPdfUrl = `/file/preview/private/${result.data.path}`;
      setPdfUrl(nextPdfUrl);
      setPdfFile(null);
      setPdfViewPage(1);
      setNumPages(0);
      setPdfMetrics(null);

      const formData = new FormData();
      formData.set("pdfUrl", nextPdfUrl);

      if (options.clearBalloons) {
        const persistedBalloonDeleteIds = featureRows
          .filter(
            (r): r is FeatureRow & { balloonId: string } =>
              r.balloonId != null && !isTempBalloonId(r.balloonId)
          )
          .map((r) => r.balloonId);

        formData.set(
          "balloons",
          JSON.stringify({
            create: [],
            update: [],
            delete: persistedBalloonDeleteIds
          })
        );

        setSelectorRects([]);
        setFeatureRows((prev) => stripBalloonGeometryFromFeatureRows(prev));
        pendingBalloonDeleteIdsRef.current.clear();
        pdfReplaceToastRef.current = true;
        pdfReplacePendingMetricsRef.current = true;
      }

      fetcher.submit(formData, {
        method: "post",
        action: path.to.saveInspectionDocument(diagramId)
      });
    },
    [carbon, companyId, diagramId, featureRows, fetcher, t]
  );

  const handlePdfUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !carbon) return;

      const replacingExistingPdf = pdfUrl.trim() !== "";
      const shouldConfirmClearBalloons =
        replacingExistingPdf && hasBalloonGeometry(featureRows, anchorRects);

      if (shouldConfirmClearBalloons) {
        setPendingReplacePdfFile(file);
        setReplacePdfConfirmOpen(true);
        return;
      }

      await uploadPdfAndSave(file, { clearBalloons: false });
    },
    [anchorRects, carbon, featureRows, pdfUrl, uploadPdfAndSave]
  );

  const handleConfirmReplacePdf = useCallback(async () => {
    const file = pendingReplacePdfFile;
    setReplacePdfConfirmOpen(false);
    setPendingReplacePdfFile(null);
    if (!file) return;
    await uploadPdfAndSave(file, { clearBalloons: true });
  }, [pendingReplacePdfFile, uploadPdfAndSave]);

  const handleCancelReplacePdf = useCallback(() => {
    setReplacePdfConfirmOpen(false);
    setPendingReplacePdfFile(null);
  }, []);

  const hasPdf = pdfFile !== null || pdfUrl !== "";
  const isPdfReady = hasPdf && (numPages > 0 || pdfMetrics !== null);
  const isOverlayReady = isPdfReady && containerWidth > 0 && overlayHeight > 0;

  const handleDeleteFeature = useCallback((featureId: string) => {
    setFeatureRows((prev) => {
      const row = prev.find((r) => r.featureId === featureId);
      if (row && !isTempFeatureId(row.featureId)) {
        pendingFeatureDeleteIdsRef.current.add(row.featureId);
      }
      const nextRows = prev.filter((r) => r.featureId !== featureId);
      const keptAnchorIds = new Set(
        nextRows
          .map((r) => r.balloonAnchorId)
          .filter((id): id is string => id.length > 0)
      );
      setSelectorRects((sels) =>
        sels.filter((sel) => keptAnchorIds.has(sel.id))
      );
      return nextRows;
    });
  }, []);

  const handleAddFeature = useCallback(() => {
    setFeatureRows((prev) => {
      const label = nextBalloonLabel(prev);
      return [
        ...prev,
        {
          featureId: `temp-ftr-${nanoid()}`,
          balloonId: null,
          balloonAnchorId: "",
          label,
          pageNumber: pdfViewPage,
          x: 0,
          y: 0,
          width: BALLOON_W_PCT,
          height: BALLOON_H_PCT,
          featureName: `Feature ${label}`,
          nominalValue: "",
          tolerancePlus: "",
          toleranceMinus: "",
          units: "",
          type: "Measurement"
        }
      ];
    });
  }, [pdfViewPage]);

  const handlePlaceFeatureOnDrawing = useCallback((featureId: string) => {
    setPlacingFeatureId(featureId);
    setPlacing(true);
    setPlacingAnnotation(false);
    setZoomBoxMode(false);
  }, []);

  const handleUnballoon = useCallback((featureId: string) => {
    setFeatureRows((prev) => {
      const row = prev.find((r) => r.featureId === featureId);
      if (!row?.balloonId) return prev;
      if (!isTempBalloonId(row.balloonId)) {
        pendingBalloonDeleteIdsRef.current.add(row.balloonId);
      }
      if (row.balloonAnchorId) {
        setSelectorRects((sels) =>
          sels.filter((s) => s.id !== row.balloonAnchorId)
        );
      }
      return prev.map((r) =>
        r.featureId !== featureId
          ? r
          : {
              ...r,
              balloonId: null,
              balloonAnchorId: "",
              x: 0,
              y: 0,
              geometryDirty: false
            }
      );
    });
  }, []);

  const updateFeatureField = useCallback(
    (
      featureId: string,
      field:
        | "label"
        | "featureName"
        | "nominalValue"
        | "tolerancePlus"
        | "toleranceMinus"
        | "units"
        | "type",
      value: string
    ) => {
      setFeatureRows((prev) =>
        prev.map((r) =>
          r.featureId !== featureId
            ? r
            : {
                ...r,
                [field]: value,
                featureDirty: isTempFeatureId(r.featureId)
                  ? r.featureDirty
                  : true
              }
        )
      );
    },
    []
  );

  const featureMutation = useCallback(
    async (accessorKey: string, newValue: string, row: FeatureRow) => {
      updateFeatureField(
        row.featureId,
        accessorKey as
          | "label"
          | "featureName"
          | "nominalValue"
          | "tolerancePlus"
          | "toleranceMinus"
          | "units"
          | "type",
        newValue
      );
      return {
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK"
      } as const;
    },
    [updateFeatureField]
  );

  const unitOfMeasureOptions = useMemo(
    () => unitOfMeasures.map((uom) => ({ value: uom.code, label: uom.name })),
    [unitOfMeasures]
  );

  const uomCodeToName = useMemo(
    () => new Map(unitOfMeasures.map((uom) => [uom.code, uom.name])),
    [unitOfMeasures]
  );

  const featureEditableComponents = useMemo(
    () => ({
      type: EditableList(featureMutation, featureTypeOptions),
      label: EditableText(featureMutation),
      featureName: EditableText(featureMutation),
      nominalValue: ConditionalMeasurementText(featureMutation),
      tolerancePlus: ConditionalMeasurementText(featureMutation),
      toleranceMinus: ConditionalMeasurementText(featureMutation),
      units: ConditionalMeasurementList(featureMutation, unitOfMeasureOptions)
    }),
    [featureMutation, unitOfMeasureOptions]
  );

  const featureColumns = useMemo<ColumnDef<FeatureRow>[]>(
    () => [
      { accessorKey: "label", header: t`Feature`, size: 80 },
      {
        accessorKey: "type",
        header: t`Type`,
        size: 140,
        cell: ({ row }) => (
          <HStack spacing={1} className="items-center">
            <ProcedureStepTypeIcon
              type={
                row.original
                  .type as Database["public"]["Enums"]["procedureStepType"]
              }
              className="h-4 w-4"
            />
            <span className="text-sm">{row.original.type}</span>
          </HStack>
        )
      },
      { accessorKey: "featureName", header: t`Description` },
      {
        accessorKey: "nominalValue",
        header: t`Nom`,
        size: 112,
        cell: ({ row }) =>
          row.original.type === "Measurement" ? row.original.nominalValue : null
      },
      {
        accessorKey: "tolerancePlus",
        header: t`Tol+`,
        size: 112,
        cell: ({ row }) =>
          row.original.type === "Measurement"
            ? row.original.tolerancePlus
            : null
      },
      {
        accessorKey: "toleranceMinus",
        header: t`Tol-`,
        size: 112,
        cell: ({ row }) =>
          row.original.type === "Measurement"
            ? row.original.toleranceMinus
            : null
      },
      {
        accessorKey: "units",
        header: t`Units`,
        size: 96,
        cell: ({ row }) =>
          row.original.type === "Measurement"
            ? (uomCodeToName.get(row.original.units) ?? row.original.units)
            : null
      },
      {
        id: "actions",
        header: t`Actions`,
        size: 148,
        cell: ({ row }) => (
          <HStack spacing={0} className="items-center">
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t`Remove feature`}
              icon={<LuTrash2 className="h-4 w-4 text-destructive" />}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteFeature(row.original.featureId);
              }}
            />
            <span
              className="mx-1.5 h-5 w-px shrink-0 bg-foreground/20 dark:bg-white/30"
              aria-hidden
            />
            {row.original.balloonId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnballoon(row.original.featureId);
                }}
              >
                {t`Unballoon`}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<LuRectangleHorizontal className="h-3.5 w-3.5" />}
                isDisabled={!isOverlayReady}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlaceFeatureOnDrawing(row.original.featureId);
                }}
              >
                {t`Balloon`}
              </Button>
            )}
          </HStack>
        )
      }
    ],
    [
      handleDeleteFeature,
      handlePlaceFeatureOnDrawing,
      handleUnballoon,
      isOverlayReady,
      uomCodeToName,
      t
    ]
  );

  const handleDownloadPdfWithBalloons = useCallback(async () => {
    if (!hasPdf) {
      toast.error(t`Upload a PDF first`);
      return;
    }
    setPdfExporting(true);
    try {
      let bytes: ArrayBuffer;
      if (pdfFile) {
        bytes = await pdfFile.arrayBuffer();
      } else {
        const res = await fetch(pdfUrl, { credentials: "include" });
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        bytes = await res.arrayBuffer();
      }
      const placedRows = featureRows
        .filter(
          (r): r is FeatureRow & { balloonId: string } => r.balloonId != null
        )
        .map((r) => ({
          balloonId: r.balloonId,
          balloonAnchorId: r.balloonAnchorId,
          label: r.label,
          pageNumber: r.pageNumber,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height
        }));
      const outBytes = await buildInspectionDocumentPdfWithOverlaysBytes({
        pdfBytes: bytes,
        featureRows: placedRows,
        anchorRects,
        scale: 2
      });
      const blobBytes = new Uint8Array(outBytes.byteLength);
      blobBytes.set(outBytes);
      triggerDownload(
        new Blob([blobBytes], { type: "application/pdf" }),
        `${sanitizeFilenameBase(name)}-with-balloons.pdf`
      );
      toast.success(t`PDF downloaded`);
    } catch {
      toast.error(t`Could not build PDF. Try again.`);
    } finally {
      setPdfExporting(false);
    }
  }, [hasPdf, pdfFile, pdfUrl, name, featureRows, anchorRects, t]);

  const previewRect =
    drag &&
    dragKind !== "balloonMove" &&
    dragKind !== "anchorResize" &&
    dragKind !== "annotationResize"
      ? {
          x: Math.min(drag.startX, drag.currentX),
          y: Math.min(drag.startY, drag.currentY),
          width: Math.abs(drag.currentX - drag.startX),
          height: Math.abs(drag.currentY - drag.startY)
        }
      : null;
  const renderedWidth =
    containerWidth > 0 ? Math.max(1, containerWidth * zoomScale) : 0;
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Modal
        open={replacePdfConfirmOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelReplacePdf();
        }}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{t`Replace drawing?`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              {t`Replacing the PDF removes all balloon placements on this document. Feature rows and their values stay; you can place balloons again on the new drawing.`}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancelReplacePdf}
              isDisabled={uploading}
            >
              {t`Cancel`}
            </Button>
            <Button
              type="button"
              isLoading={uploading}
              isDisabled={uploading}
              onClick={() => void handleConfirmReplacePdf()}
            >
              {t`Replace PDF`}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handlePdfUpload}
        disabled={uploading}
      />

      {/* Header bar — min-height only so controls are not clipped when the row wraps */}
      <div className="flex min-h-[50px] flex-shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 overflow-x-auto border-b border-border bg-card px-4 py-2 scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <div className="min-w-0 flex-1 pr-2">
          <Input
            borderless
            value={title}
            placeholder={t`Untitled Diagram`}
            className="font-semibold text-base truncate"
            onChange={(e) => {
              setTitle(e.target.value);
              debouncedSaveName(e.target.value);
            }}
          />
        </div>
        <HStack spacing={2} className="flex-shrink-0 flex-wrap justify-end">
          <Button
            variant={placing ? "primary" : "secondary"}
            leftIcon={<LuRectangleHorizontal />}
            onClick={() => {
              setPlacing((v) => {
                const next = !v;
                if (next) {
                  setPlacingAnnotation(false);
                  setZoomBoxMode(false);
                  setPlacingFeatureId(null);
                }
                return next;
              });
            }}
            isDisabled={!isOverlayReady}
          >
            {placing ? t`Drag to place on drawing` : t`Add Selector`}
          </Button>
          <Button
            variant={zoomBoxMode ? "primary" : "secondary"}
            onClick={() => {
              setZoomBoxMode((v) => {
                const next = !v;
                if (next) {
                  setPlacing(false);
                  setPlacingAnnotation(false);
                }
                return next;
              });
            }}
            isDisabled={!isOverlayReady}
          >
            {zoomBoxMode ? t`Drag to zoom` : t`Zoom Box`}
          </Button>
          {hasPdf && (
            <Button
              variant="secondary"
              leftIcon={<LuUpload />}
              onClick={() => fileInputRef.current?.click()}
              isDisabled={uploading}
            >
              {uploading ? t`Uploading…` : t`Replace PDF`}
            </Button>
          )}
          {hasPdf && (
            <Button
              type="button"
              variant="secondary"
              leftIcon={<LuFileDown className="h-4 w-4" />}
              onClick={handleDownloadPdfWithBalloons}
              isDisabled={pdfExporting}
              isLoading={pdfExporting}
            >
              {t`Download PDF`}
            </Button>
          )}
          <Button
            leftIcon={<LuSave />}
            onClick={handleSave}
            isDisabled={fetcher.state !== "idle"}
          >
            {t`Save`}
          </Button>
          <HStack className="ml-1 rounded-md border bg-background px-1 py-1">
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t`Zoom out`}
              icon={<LuMinus />}
              onClick={() =>
                setZoomScale((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))
              }
            />
            <span className="min-w-14 select-none text-center text-sm font-medium">
              {Math.round(zoomScale * 100)}%
            </span>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t`Zoom in`}
              icon={<LuPlus />}
              onClick={() =>
                setZoomScale((z) => Math.min(3, Number((z + 0.1).toFixed(2))))
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setZoomScale(1);
                requestAnimationFrame(() => {
                  if (!containerRef.current) return;
                  containerRef.current.scrollLeft = 0;
                  containerRef.current.scrollTop = 0;
                });
              }}
            >
              {t`Reset View`}
            </Button>
          </HStack>
        </HStack>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2">
        <div
          ref={editorStackRef}
          className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
        >
          {/* PDF viewer — outer measures width, inner fills container */}
          <div
            className={`flex min-h-0 min-w-full flex-col overflow-hidden rounded-lg border bg-muted ${
              featuresTableExpanded ? "shrink-0" : "min-h-[220px] flex-1"
            }`}
            style={{
              ...(featuresTableExpanded
                ? { height: pdfPaneHeightPx }
                : undefined),
              minWidth: "100%"
            }}
          >
            {hasPdf && documentPageCount > 1 ? (
              <div
                role="navigation"
                aria-label={t`PDF pages`}
                className="flex shrink-0 items-center justify-center gap-3 border-b border-border bg-card px-3 py-2.5 shadow-sm"
              >
                <IconButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={t`Previous page`}
                  icon={<LuChevronLeft className="h-4 w-4" />}
                  isDisabled={pdfViewPage <= 1}
                  onClick={() => setPdfViewPage((p) => Math.max(1, p - 1))}
                />
                <span className="min-w-[8.5rem] select-none text-center text-sm font-medium tabular-nums text-foreground">
                  {t`Page ${pdfViewPage} of ${documentPageCount}`}
                </span>
                <IconButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={t`Next page`}
                  icon={<LuChevronRight className="h-4 w-4" />}
                  isDisabled={pdfViewPage >= documentPageCount}
                  onClick={() =>
                    setPdfViewPage((p) => Math.min(documentPageCount, p + 1))
                  }
                />
              </div>
            ) : null}
            <div
              ref={containerRef}
              className="relative min-h-0 min-w-full flex-1 overflow-auto"
              style={{
                ...(placing || placingAnnotation || zoomBoxMode
                  ? { cursor: "crosshair" }
                  : {}),
                minWidth: "100%"
              }}
            >
              {hasPdf ? (
                <div
                  ref={overlayRef}
                  className="relative select-none"
                  style={{ width: renderedWidth > 0 ? renderedWidth : "100%" }}
                  onMouseLeave={() => {
                    if (drag) setDrag(null);
                    if (dragKind) setDragKind(null);
                    balloonDragRef.current = null;
                    annotationResizeRef.current = null;
                    anchorResizeRef.current = null;
                    const el = konvaContentFromStageRef(stageRef);
                    if (el) el.style.cursor = "";
                  }}
                >
                  {isMounted && (
                    <div className="pointer-events-none">
                      <Document
                        file={pdfFile ?? pdfUrl}
                        onLoadSuccess={async (pdf) => {
                          setNumPages(pdf.numPages);
                          setPdfViewPage(1);
                          try {
                            const page = await pdf.getPage(1);
                            const viewport = page.getViewport({ scale: 1 });
                            setPdfMetrics({
                              pageCount: pdf.numPages,
                              defaultPageWidth: viewport.width,
                              defaultPageHeight: viewport.height
                            });
                          } catch {
                            setPdfMetrics(null);
                          }
                        }}
                        onLoadError={(err) =>
                          toast.error(`PDF error: ${err.message}`)
                        }
                      >
                        {numPages > 0 ? (
                          <Page
                            key={pdfViewPage}
                            pageNumber={pdfViewPage}
                            width={
                              renderedWidth > 0 ? renderedWidth : undefined
                            }
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            className="w-full"
                            onRenderSuccess={() => setPdfPageRendered(true)}
                          />
                        ) : null}
                      </Document>
                    </div>
                  )}

                  {pdfPageRendered &&
                    containerWidth > 0 &&
                    overlayHeight > 0 && (
                      <div className="pointer-events-auto absolute inset-0 z-[9]">
                        <Stage
                          ref={stageRef as never}
                          width={renderedWidth}
                          height={overlayHeight}
                          listening
                          onMouseDown={handleStageMouseDown as never}
                          onMouseMove={handleStageMouseMove as never}
                          onMouseUp={handleStageMouseUp as never}
                        >
                          <Layer>
                            {anchorRects
                              .filter((s) => s.pageNumber === pdfViewPage)
                              .map((s) => {
                                const pageHeightPx = overlayHeight;
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
                                    stroke={CALLOUT_STROKE}
                                    strokeWidth={isSelected ? 3 : 2}
                                    fill={
                                      isSelected
                                        ? "rgba(249,115,22,0.12)"
                                        : undefined
                                    }
                                    fillEnabled={isSelected}
                                    hitStrokeWidth={8}
                                    listening={false}
                                  />
                                );
                              })}
                            {annotations
                              .filter((a) => a.pageNumber === pdfViewPage)
                              .map((annotation) => {
                                const pageHeightPx = overlayHeight;
                                const x = (annotation.x / 100) * renderedWidth;
                                const y = (annotation.y / 100) * pageHeightPx;
                                const w =
                                  (annotation.width / 100) * renderedWidth;
                                const h =
                                  (annotation.height / 100) * pageHeightPx;
                                const isSelected =
                                  annotation.id === selectedAnnotationId;
                                const previewText =
                                  annotationEditDraft?.id === annotation.id
                                    ? annotationEditDraft.text
                                    : annotation.text;
                                const previewFontSize =
                                  annotationEditDraft?.id === annotation.id
                                    ? annotationEditDraft.fontSize
                                    : annotation.fontSize;

                                return (
                                  <Group
                                    key={`annotation-${annotation.id}`}
                                    x={x}
                                    y={y}
                                  >
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
                                      stroke={CALLOUT_STROKE}
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
                                const pageHeightPx = overlayHeight;
                                const x =
                                  (annotationDraft.x / 100) * renderedWidth;
                                const y =
                                  (annotationDraft.y / 100) * pageHeightPx;
                                const w =
                                  (annotationDraft.width / 100) * renderedWidth;
                                const h =
                                  (annotationDraft.height / 100) * pageHeightPx;

                                return (
                                  <Group key="annotation-draft" x={x} y={y}>
                                    <Rect
                                      x={0}
                                      y={0}
                                      width={w}
                                      height={h}
                                      fill="rgba(249,115,22,0.16)"
                                      stroke={CALLOUT_STROKE}
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
                              .filter(
                                (b) =>
                                  b.pageNumber === pdfViewPage && b.balloonId
                              )
                              .map((b) => {
                                const pageHeightPx = overlayHeight;
                                const balloonWidthPx =
                                  (b.width / 100) * renderedWidth;
                                const balloonHeightPx =
                                  (b.height / 100) * pageHeightPx;
                                const balloonX = (b.x / 100) * renderedWidth;
                                const balloonY = (b.y / 100) * pageHeightPx;
                                const balloonCenterX =
                                  balloonX + balloonWidthPx / 2;
                                const balloonCenterY =
                                  balloonY + balloonHeightPx / 2;
                                const radius = Math.max(
                                  8,
                                  Math.min(balloonWidthPx, balloonHeightPx) / 2
                                );
                                const balloonLabelFontSize = Math.max(
                                  14,
                                  Math.min(26, Math.round(radius * 1.15))
                                );
                                const isSelected =
                                  b.balloonId === selectedBalloonId;
                                const linkedSelector = anchorRects.find(
                                  (s) => s.id === b.balloonAnchorId
                                );
                                let linePoints:
                                  | [number, number, number, number]
                                  | null = null;
                                if (
                                  linkedSelector &&
                                  linkedSelector.pageNumber === pdfViewPage
                                ) {
                                  const sx =
                                    (linkedSelector.x / 100) * renderedWidth;
                                  const sy =
                                    (linkedSelector.y / 100) * pageHeightPx;
                                  const sw =
                                    (linkedSelector.width / 100) *
                                    renderedWidth;
                                  const sh =
                                    (linkedSelector.height / 100) *
                                    pageHeightPx;
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
                                        stroke={CALLOUT_STROKE}
                                        strokeWidth={2}
                                        listening={false}
                                      />
                                    )}
                                    <Circle
                                      key={`balloon-circle-${b.balloonId}`}
                                      x={balloonWidthPx / 2}
                                      y={balloonHeightPx / 2}
                                      radius={radius}
                                      fill={
                                        isSelected
                                          ? "rgba(249,115,22,0.14)"
                                          : "rgba(0,0,0,0)"
                                      }
                                      fillEnabled
                                      stroke={CALLOUT_STROKE}
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
                                      fill={CALLOUT_STROKE}
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
                                width={
                                  (previewRect.width / 100) * renderedWidth
                                }
                                height={
                                  (previewRect.height / 100) * overlayHeight
                                }
                                stroke={
                                  dragKind === "zoom"
                                    ? "#2563eb"
                                    : CALLOUT_STROKE
                                }
                                strokeWidth={2}
                                fillEnabled={false}
                              />
                            )}
                          </Layer>
                        </Stage>
                      </div>
                    )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center min-w-full h-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                >
                  <VStack className="items-center gap-2">
                    {uploading ? (
                      <LuLoader className="h-12 w-12 opacity-30 animate-spin" />
                    ) : (
                      <LuUpload className="h-12 w-12 opacity-30" />
                    )}
                    <p>
                      {uploading
                        ? t`Uploading…`
                        : t`Click to upload a PDF drawing`}
                    </p>
                  </VStack>
                </button>
              )}
              {annotationDraft &&
                annotationDraft.pageNumber === pdfViewPage &&
                renderedWidth > 0 &&
                overlayHeight > 0 && (
                  <div
                    className="absolute z-20 rounded-md border bg-background p-2 shadow-md"
                    style={getAnnotationDialogPosition({
                      renderedWidth,
                      overlayHeight,
                      totalPagesStage: 1,
                      pageNumber: annotationDraft.pageNumber,
                      x: annotationDraft.x,
                      y: annotationDraft.y,
                      width: annotationDraft.width,
                      height: annotationDraft.height
                    })}
                  >
                    <VStack spacing={2} className="w-52">
                      <input
                        className="h-8 w-full rounded border bg-background px-2 text-xs"
                        placeholder={t`Annotation text`}
                        value={annotationDraft.text}
                        onChange={(event) =>
                          setAnnotationDraft((prev) =>
                            prev ? { ...prev, text: event.target.value } : prev
                          )
                        }
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        className="h-8 w-full rounded border bg-background px-2 text-xs"
                        placeholder={t`Text size`}
                        value={annotationFontSizeInput}
                        onChange={(event) => {
                          const raw = event.target.value;
                          if (!/^\d*$/.test(raw)) return;
                          setAnnotationFontSizeInput(raw);
                          if (raw === "") return;
                          const parsed = Number(raw);
                          if (!Number.isFinite(parsed)) return;
                          setAnnotationDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  fontSize: Math.max(8, Math.min(48, parsed))
                                }
                              : prev
                          );
                        }}
                        onBlur={() => {
                          const parsed = Number(
                            annotationFontSizeInput || "12"
                          );
                          const normalized = Math.max(
                            8,
                            Math.min(48, Number.isFinite(parsed) ? parsed : 12)
                          );
                          setAnnotationFontSizeInput(String(normalized));
                          setAnnotationDraft((prev) =>
                            prev ? { ...prev, fontSize: normalized } : prev
                          );
                        }}
                      />
                      <HStack spacing={1} className="justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAnnotationDraft(null);
                            setAnnotationFontSizeInput("12");
                          }}
                        >
                          {t`Cancel`}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleCreateAnnotation()}
                        >
                          {t`Add`}
                        </Button>
                      </HStack>
                    </VStack>
                  </div>
                )}
              {!annotationDraft &&
                annotationEditDraft &&
                annotationEditDraft.pageNumber === pdfViewPage &&
                renderedWidth > 0 &&
                overlayHeight > 0 && (
                  <div
                    className="absolute z-20 rounded-md border bg-background p-2 shadow-md"
                    style={getAnnotationDialogPosition({
                      renderedWidth,
                      overlayHeight,
                      totalPagesStage: 1,
                      pageNumber: annotationEditDraft.pageNumber,
                      x: annotationEditDraft.x,
                      y: annotationEditDraft.y,
                      width: annotationEditDraft.width,
                      height: annotationEditDraft.height
                    })}
                  >
                    <VStack spacing={2} className="w-52">
                      <input
                        className="h-8 w-full rounded border bg-background px-2 text-xs"
                        placeholder={t`Annotation text`}
                        value={annotationEditDraft.text}
                        onChange={(event) =>
                          setAnnotationEditDraft((prev) =>
                            prev ? { ...prev, text: event.target.value } : prev
                          )
                        }
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        className="h-8 w-full rounded border bg-background px-2 text-xs"
                        placeholder={t`Text size`}
                        value={annotationEditFontSizeInput}
                        onChange={(event) => {
                          const raw = event.target.value;
                          if (!/^\d*$/.test(raw)) return;
                          setAnnotationEditFontSizeInput(raw);
                          if (raw === "") return;
                          const parsed = Number(raw);
                          if (!Number.isFinite(parsed)) return;
                          setAnnotationEditDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  fontSize: Math.max(8, Math.min(48, parsed))
                                }
                              : prev
                          );
                        }}
                        onBlur={() => {
                          const parsed = Number(
                            annotationEditFontSizeInput || "12"
                          );
                          const normalized = Math.max(
                            8,
                            Math.min(48, Number.isFinite(parsed) ? parsed : 12)
                          );
                          setAnnotationEditFontSizeInput(String(normalized));
                          setAnnotationEditDraft((prev) =>
                            prev ? { ...prev, fontSize: normalized } : prev
                          );
                        }}
                      />
                      <HStack spacing={1} className="justify-between">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          leftIcon={<LuTrash2 />}
                          onClick={() => void handleDeleteAnnotation()}
                        >
                          {t`Delete`}
                        </Button>
                        <HStack spacing={1}>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedAnnotationId(null);
                              setAnnotationEditDraft(null);
                            }}
                          >
                            {t`Cancel`}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleUpdateAnnotation()}
                          >
                            {t`Update`}
                          </Button>
                        </HStack>
                      </HStack>
                    </VStack>
                  </div>
                )}
            </div>
          </div>

          {featuresTableExpanded ? (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={t`Drag to resize diagram and features`}
              aria-valuenow={Math.round(pdfPaneHeightPx)}
              className={`group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center rounded-md px-2 hover:bg-muted/80 ${
                isResizingPdfFeatures ? "bg-muted" : ""
              }`}
              onMouseDown={onSplitResizeMouseDown}
            >
              <span className="h-1 w-14 shrink-0 rounded-full bg-muted-foreground/40 group-hover:bg-muted-foreground/65" />
            </div>
          ) : null}

          {/* Features table — form fields map to balloon columns; persisted on Save */}
          <div
            className={
              featuresTableExpanded
                ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-card"
                : "flex max-h-[14rem] min-w-0 shrink-0 flex-col overflow-hidden rounded-lg bg-card"
            }
            style={
              featuresTableExpanded && editorStackHeightPx > 0
                ? { minHeight: editorStackHeightPx * 0.5 }
                : undefined
            }
          >
            <div className="flex min-h-10 flex-shrink-0 items-center justify-between gap-2 bg-muted/40 px-2 py-2 pl-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {t`Features`} ({featureRows.length})
              </span>
              <HStack spacing={1} className="flex-shrink-0 items-center">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<LuPlus className="h-4 w-4" />}
                  onClick={handleAddFeature}
                >
                  {t`Add Feature`}
                </Button>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={featuresTableExpanded}
                  aria-label={
                    featuresTableExpanded
                      ? t`Collapse features table`
                      : t`Expand features table`
                  }
                  icon={
                    featuresTableExpanded ? (
                      <LuChevronDown className="h-4 w-4" />
                    ) : (
                      <LuChevronUp className="h-4 w-4" />
                    )
                  }
                  onClick={() => setFeaturesTableExpanded((v) => !v)}
                />
              </HStack>
            </div>
            <div
              className={
                featuresTableExpanded
                  ? "min-h-0 flex-1 overflow-auto"
                  : "overflow-hidden"
              }
            >
              <Grid<FeatureRow>
                data={featureRows}
                columns={featureColumns}
                editableComponents={featureEditableComponents}
                contained={false}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
