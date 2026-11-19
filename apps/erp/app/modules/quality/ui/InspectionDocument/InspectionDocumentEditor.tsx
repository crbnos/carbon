// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useAction } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  cn,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
  toastError,
  useDebounce,
  useDisclosure,
  usePaneResize
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { storage } from "@carbon/files";
import { registerReactPdfWorker } from "@carbon/files/pdf/worker";
import { ModelUploadPreview } from "@carbon/viewer/model-upload-preview";
import {
  LuChevronDown,
  LuChevronUp,
  LuPlus,
  LuSlidersHorizontal
} from "react-icons/lu";
import Grid from "~/components/Grid";
import { ConfirmDelete } from "~/components/Modals";
import {
  useDrawerItem,
  useModelUpload,
  usePermissions,
  useUser
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { InspectionDocumentStatus } from "~/modules/quality/quality.models";
import type { SamplingStandard } from "~/modules/quality/samplingStandards";
import type { InspectionDocumentContent } from "~/modules/quality/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import AnnotationPopover from "./AnnotationPopover";
import { newFeatureId, type ParameterRow } from "./autosave";
import DrawingOverlay from "./DrawingOverlay";
import DrawingToolbar from "./DrawingToolbar";
import { buildInspectionDocumentPdfWithOverlaysBytes } from "./drawingRaster";
import {
  buildFeatureRowsFromLoader,
  type FeatureRow,
  hasBalloonGeometry,
  newFeatureRow,
  nextBalloonLabel,
  type PdfMetrics,
  readPdfBytes,
  type SelectorRect,
  sanitizeFilenameBase,
  selectorRectsFromBalloonRecords,
  stripBalloonGeometryFromFeatureRows,
  triggerDownload
} from "./editorModel";
import InspectionDocumentDropzone from "./InspectionDocumentDropzone";
import InspectionDocumentHeader, {
  type EditorTab,
  type InspectionDocumentVersion
} from "./InspectionDocumentHeader";
import InspectionDocumentWorkInstruction, {
  useWorkInstructionDraft
} from "./InspectionDocumentWorkInstruction";
import type { SamplingRule } from "./SamplingRuleModal";
import SamplingRuleModal, { EMPTY_SAMPLING_RULE } from "./SamplingRuleModal";
import { useDrawingInteractions } from "./useDrawingInteractions";
import { useFeatureColumns, useSamplingRuleSummary } from "./useFeatureColumns";
import {
  useInspectionDocumentAutosave,
  useSaveLedger
} from "./useInspectionDocumentAutosave";
import { useParameterRows } from "./useParameterRows";

// Registered here, not in the client entry: this module is lazy, so the PDF
// engine stays out of every page that shows no PDF.
registerReactPdfWorker(pdfjs);

type InspectionDocumentEditorProps = {
  diagramId: string;
  name: string;
  partId: string | null;
  content: InspectionDocumentContent | null;
  features: Array<Record<string, unknown>>;
  balloons: Array<Record<string, unknown>>;
  unitOfMeasures: Array<{ code: string; name: string }>;
  gaugeTypes: Array<{ id: string; name: string }>;
  // Fixed key/value pairs the inspector reads on every lot of the plan.
  parameters: Array<{ id: string; key: string; value: string }>;
  // Rich text the inspector reads on every lot of the plan.
  workInstruction: JSONContent | null;
  // The document's default sampling rule (fallback for features without a
  // rule) and the company's sampling standard for previews.
  sampling: SamplingRule | null;
  samplingStandard: SamplingStandard;
  // A plan made from a model's PMI holds the model instead of a PDF: the top
  // pane shows the model and the PDF tools are hidden.
  model: { modelUploadId: string; modelPath: string | null } | null;
  // Only a Draft version can be edited; the versions of the plan, newest first.
  version: number;
  status: InspectionDocumentStatus;
  versions: InspectionDocumentVersion[];
};

const EDITOR_SPLITTER_H = 8;
const MIN_PDF_PANE_PX = 160;

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

export default function InspectionDocumentEditor({
  diagramId,
  name,
  partId,
  content,
  features: initialFeatures,
  balloons,
  unitOfMeasures,
  gaugeTypes,
  parameters: initialParameters,
  workInstruction,
  sampling,
  samplingStandard,
  model,
  version,
  status,
  versions
}: InspectionDocumentEditorProps) {
  const { t } = useLingui();
  const samplingRuleSummary = useSamplingRuleSummary();
  const permissions = usePermissions();
  // Active and Archived versions are what lots were inspected against.
  const isLocked = status !== "Draft";
  const canUpdate = permissions.can("update", "quality") && !isLocked;
  const [items] = useItems();
  const deleteDisclosure = useDisclosure();
  // A model plan: the characteristic whose PMI item the model shows.
  const [modelFeatureId, setModelFeatureId] = useState<string | null>(null);

  const part = partId ? items.find((i) => i.id === partId) : undefined;
  const itemMasterLink =
    part && part.type !== "Fixture"
      ? getLinkToItemDetails(part.type, part.id)
      : null;
  const nameFetcher = useAction();
  const [title, setTitle] = useState(name);
  // A typed name waiting out its debounce, so Publish waits for it rather
  // than locking the version under it.
  const [namePending, setNamePending] = useState(false);
  const debouncedSaveName = useDebounce((value: string) => {
    setNamePending(false);
    nameFetcher.submit(
      { name: value },
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
  // The document's default sampling rule; autosaved alongside the
  // feature rows. "document" | featureId targets the sampling modal.
  const [docSampling, setDocSampling] = useState<SamplingRule>(
    sampling ?? EMPTY_SAMPLING_RULE
  );
  // The plan's parameters; autosaved as a whole list when they change.
  const {
    parameterRows,
    parametersPayload,
    handleAddParameter,
    parameterColumns,
    parameterEditableComponents
  } = useParameterRows(initialParameters, canUpdate);
  const [bottomTab, setBottomTab] = useState<EditorTab>("characteristics");
  const workInstructionDraft = useWorkInstructionDraft(diagramId);
  const samplingModal = useDrawerItem<"document" | string>();
  const { item: samplingTarget, open: openSamplingModal } = samplingModal;
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
  // A model plan: each characteristic's PMI item, for the model pane.
  const pmiLinks = useMemo(
    () =>
      featureRows.map((row) => ({
        id: row.featureId,
        pmiItemId: row.pmiItemId
      })),
    [featureRows]
  );
  const [zoomScale, setZoomScale] = useState(1);
  const [numPages, setNumPages] = useState<number>(0);
  /** 1-based page index for the PDF viewer (one page on screen at a time). */
  const [pdfViewPage, setPdfViewPage] = useState(1);
  const [pdfMetrics, setPdfMetrics] = useState<PdfMetrics | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [overlayHeight, setOverlayHeight] = useState<number>(0);
  /** Expanded when no PDF (edit features); collapsed when a document is loaded (room for drawing). */
  const [featuresTableExpanded, setFeaturesTableExpanded] = useState(
    () => !(content?.pdfUrl ?? "").trim()
  );
  /** Height of PDF block when table is expanded (px); drag the splitter to adjust. */
  const [pdfPaneHeightPx, setPdfPaneHeightPx] = useState(360);
  const [editorStackHeightPx, setEditorStackHeightPx] = useState(0);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfPageRendered, setPdfPageRendered] = useState(false);
  const prevPdfViewPageRef = useRef(pdfViewPage);
  if (prevPdfViewPageRef.current !== pdfViewPage) {
    prevPdfViewPageRef.current = pdfViewPage;
    setPdfPageRendered(false);
  }
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorStackRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** A replaced drawing's page metrics still need saving once it renders. */
  const [pdfMetricsDirty, setPdfMetricsDirty] = useState(false);
  const ledger = useSaveLedger();
  const { queueDelete, unsavedIdsRef } = ledger;

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

  const splitResize = usePaneResize({
    height: pdfPaneHeightPx,
    clamp: (height) =>
      clampPdfPaneHeight(height, editorStackHeightPx, featuresTableExpanded),
    enabled: featuresTableExpanded && editorStackHeightPx > 0,
    onCommit: setPdfPaneHeightPx
  });

  // A plan with no drawing or model has no viewer: the characteristics fill
  // the page and the upload sits in a sidebar.
  const hasDocument = pdfFile !== null || pdfUrl !== "" || !!model;

  // Measure container width and keep it up to date on resize. The viewer
  // mounts only once the plan has a document, so measure again then.
  useEffect(() => {
    if (!hasDocument || !containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [hasDocument]);

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

  const drawing = useDrawingInteractions({
    diagramId,
    canUpdate,
    pdfViewPage,
    pdfFile,
    pdfUrl,
    featureRows,
    setFeatureRows,
    anchorRects,
    setSelectorRects,
    zoomScale,
    setZoomScale,
    containerWidth,
    overlayHeight,
    containerRef,
    overlayRef,
    unsavedIdsRef
  });

  const autosave = useInspectionDocumentAutosave({
    diagramId,
    name,
    canUpdate,
    ledger,
    featureRows,
    setFeatureRows,
    anchorRects,
    setSelectorRects,
    docSampling,
    parameterRows,
    parametersPayload,
    pdfUrl,
    pdfMetrics,
    pdfMetricsDirty,
    setPdfMetricsDirty,
    uploading,
    dragKind: drawing.dragKind
  });
  const { blocker, isLeaving, saveFailed, pdfReplaceToastRef } = autosave;

  const uploadPdfAndSave = useCallback(
    async (file: File, options: { clearBalloons: boolean }) => {
      if (!carbon) return;

      setUploading(true);

      const storagePath = `${companyId}/inspectionDocument/${diagramId}/${nanoid()}.pdf`;
      const result = await storage(carbon)
        .company(companyId)
        .upload(storagePath, file);

      setUploading(false);

      if (result.error) {
        toastError(t`Failed to upload PDF`, result.error);
        return;
      }

      const nextPdfUrl = `/file/preview/private/${result.data.path}`;
      setPdfUrl(nextPdfUrl);
      setPdfFile(null);
      setPdfViewPage(1);
      setNumPages(0);
      setPdfMetrics(null);
      // The new URL, the cleared balloons and the new drawing's page metrics
      // (once it renders) all reach the server through the autosave.
      setPdfMetricsDirty(true);

      if (options.clearBalloons) {
        for (const r of featureRows) {
          if (r.balloonId != null) {
            queueDelete(ledger.pendingBalloonDeleteIdsRef.current, r.balloonId);
          }
        }
        setSelectorRects([]);
        setFeatureRows((prev) => stripBalloonGeometryFromFeatureRows(prev));
        pdfReplaceToastRef.current = true;
      }
    },
    [
      carbon,
      companyId,
      diagramId,
      featureRows,
      t,
      queueDelete,
      ledger.pendingBalloonDeleteIdsRef,
      pdfReplaceToastRef
    ]
  );

  // A dropped STEP file is staged (resumable upload), then attached to the
  // plan; the route revalidates, so the loader returns the model and the
  // viewer replaces the sidebar.
  const modelUpload = useModelUpload(`inspection-document:${diagramId}`);
  const modelFetcher = useAction();
  // Publishing locks the version, so it waits for every edit to land.
  const hasPendingEdits =
    autosave.hasUnsavedChanges ||
    autosave.isSaving ||
    uploading ||
    namePending ||
    nameFetcher.state !== "idle" ||
    workInstructionDraft.isPending ||
    modelUpload.upload !== null ||
    modelFetcher.state !== "idle";
  const handleModelUpload = useCallback(
    async (file: File) => {
      const staged = await modelUpload.runUpload(file);
      if (staged.error) {
        toast.error(t`Failed to upload the model`);
        return;
      }
      modelFetcher.submit(
        {
          modelId: staged.modelId,
          modelPath: staged.modelPath,
          name: file.name,
          size: String(file.size)
        },
        { method: "post", action: path.to.inspectionDocumentModel(diagramId) }
      );
    },
    [diagramId, modelFetcher, modelUpload, t]
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
  // Without a document the table has the page to itself.
  const onCharacteristics = bottomTab === "characteristics";
  // Parameters and instructions have no drawing: they fill the pane.
  const tableFillsPane =
    !hasDocument || featuresTableExpanded || !onCharacteristics;
  const isPdfReady = hasPdf && (numPages > 0 || pdfMetrics !== null);
  const isOverlayReady = isPdfReady && containerWidth > 0 && overlayHeight > 0;

  const handleDeleteFeature = useCallback(
    (featureId: string) => {
      setFeatureRows((prev) => {
        const row = prev.find((r) => r.featureId === featureId);
        if (row) {
          queueDelete(ledger.pendingFeatureDeleteIdsRef.current, row.featureId);
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
    },
    [queueDelete, ledger.pendingFeatureDeleteIdsRef]
  );

  const handleAddFeature = useCallback(() => {
    const featureId = newFeatureId();
    unsavedIdsRef.current.add(featureId);
    setFeatureRows((prev) => [
      ...prev,
      newFeatureRow({
        featureId,
        balloonId: null,
        balloonAnchorId: "",
        label: nextBalloonLabel(prev),
        pageNumber: pdfViewPage,
        x: 0,
        y: 0
      })
    ]);
  }, [pdfViewPage, unsavedIdsRef]);

  const handleUnballoon = useCallback(
    (featureId: string) => {
      setFeatureRows((prev) => {
        const row = prev.find((r) => r.featureId === featureId);
        if (!row?.balloonId) return prev;
        queueDelete(ledger.pendingBalloonDeleteIdsRef.current, row.balloonId);
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
    },
    [queueDelete, ledger.pendingBalloonDeleteIdsRef]
  );

  const updateFeatureSampling = useCallback(
    (featureId: string, rule: SamplingRule) => {
      setFeatureRows((prev) =>
        prev.map((r) =>
          r.featureId !== featureId ? r : { ...r, ...rule, featureDirty: true }
        )
      );
    },
    []
  );

  const { featureColumns, featureEditableComponents } = useFeatureColumns({
    setFeatureRows,
    unitOfMeasures,
    gaugeTypes,
    canUpdate,
    hasModel: !!model,
    modelFeatureId,
    onShowOnModel: setModelFeatureId,
    isOverlayReady,
    onPlaceOnDrawing: drawing.startPlacingFeature,
    onUnballoon: handleUnballoon,
    onDelete: handleDeleteFeature,
    onEditSampling: openSamplingModal,
    samplingRuleSummary
  });

  const handleDownloadPdfWithBalloons = useCallback(async () => {
    if (!hasPdf) {
      toast.error(t`Upload a PDF first`);
      return;
    }
    setPdfExporting(true);
    try {
      const bytes = await readPdfBytes(pdfFile, pdfUrl);
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

  const renderedWidth =
    containerWidth > 0 ? Math.max(1, containerWidth * zoomScale) : 0;
  const {
    placing,
    placingAnnotation,
    zoomBoxMode,
    annotationDraft,
    annotationEditDraft
  } = drawing;
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
              {t`Replacing the PDF removes all balloon placements on this document. Characteristic rows and their values stay; you can place balloons again on the new drawing.`}
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

      <InspectionDocumentHeader
        diagramId={diagramId}
        title={title}
        onTitleChange={(value) => {
          setTitle(value);
          setNamePending(true);
          debouncedSaveName(value);
        }}
        canUpdate={canUpdate}
        isLocked={isLocked}
        itemMasterLink={itemMasterLink}
        hasPdf={hasPdf}
        uploading={uploading}
        onReplacePdf={() => fileInputRef.current?.click()}
        pdfExporting={pdfExporting}
        onDownloadPdf={handleDownloadPdfWithBalloons}
        onDelete={() => deleteDisclosure.onOpen()}
        tab={bottomTab}
        onTabChange={setBottomTab}
        saveFailed={saveFailed}
        saving={autosave.hasUnsavedChanges || autosave.isSaving}
        hasSaved={autosave.hasSaved}
        version={version}
        versions={versions}
        status={status}
        hasPendingEdits={hasPendingEdits}
      />

      <Modal
        open={isLeaving && saveFailed}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{t`Unsaved changes`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              {t`Your latest changes could not be saved. Are you sure you want to leave this page?`}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              {t`Stay on this page`}
            </Button>
            <Button onClick={() => blocker.proceed?.()}>
              {t`Leave this page`}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmDelete
        action={path.to.deleteInspectionDocument(diagramId)}
        isOpen={deleteDisclosure.isOpen}
        name={title || t`this inspection plan`}
        text={t`Are you sure you want to delete this inspection plan? This cannot be undone.`}
        onCancel={() => deleteDisclosure.onClose()}
        onSubmit={() => deleteDisclosure.onClose()}
      />

      {/* No document: two flush panels, the table and the drop zone. */}
      <div
        className={
          hasDocument
            ? "flex min-h-0 flex-1 gap-4 overflow-hidden px-4 pb-4 pt-2"
            : "flex min-h-0 flex-1 overflow-hidden max-lg:flex-col"
        }
      >
        <div
          ref={editorStackRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
        >
          {/* PDF viewer — outer measures width, inner fills container */}
          {hasDocument && (
            <div
              ref={splitResize.paneRef}
              className={cn(
                "flex min-h-0 min-w-full flex-col overflow-hidden rounded-lg border bg-muted",
                featuresTableExpanded ? "shrink-0" : "min-h-[220px] flex-1",
                // Kept mounted so the drawing keeps its zoom and scroll.
                !onCharacteristics && "hidden"
              )}
              style={{
                ...(featuresTableExpanded
                  ? { height: pdfPaneHeightPx }
                  : undefined),
                minWidth: "100%"
              }}
            >
              {hasPdf && (
                <DrawingToolbar
                  canUpdate={canUpdate}
                  isOverlayReady={isOverlayReady}
                  placing={placing}
                  onTogglePlacing={drawing.togglePlacing}
                  zoomBoxMode={zoomBoxMode}
                  onToggleZoomBox={drawing.toggleZoomBox}
                  pdfViewPage={pdfViewPage}
                  setPdfViewPage={setPdfViewPage}
                  documentPageCount={documentPageCount}
                  zoomScale={zoomScale}
                  setZoomScale={setZoomScale}
                  onResetView={() => {
                    setZoomScale(1);
                    requestAnimationFrame(() => {
                      if (!containerRef.current) return;
                      containerRef.current.scrollLeft = 0;
                      containerRef.current.scrollTop = 0;
                    });
                  }}
                />
              )}
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
                  // biome-ignore lint/a11y/noStaticElementInteractions: mouse-leave only resets in-progress pointer drag state; not a control
                  <div
                    ref={overlayRef}
                    className="relative select-none"
                    style={{
                      width: renderedWidth > 0 ? renderedWidth : "100%"
                    }}
                    onMouseLeave={drawing.handleOverlayMouseLeave}
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
                          <DrawingOverlay
                            stageRef={drawing.stageRef}
                            renderedWidth={renderedWidth}
                            overlayHeight={overlayHeight}
                            pdfViewPage={pdfViewPage}
                            anchorRects={anchorRects}
                            annotations={drawing.annotations}
                            annotationDraft={annotationDraft}
                            annotationEditDraft={annotationEditDraft}
                            featureRows={featureRows}
                            selectedSelectorId={drawing.selectedSelectorId}
                            selectedAnnotationId={drawing.selectedAnnotationId}
                            selectedBalloonId={drawing.selectedBalloonId}
                            previewRect={drawing.previewRect}
                            dragKind={drawing.dragKind}
                            onMouseDown={drawing.handleStageMouseDown}
                            onMouseMove={drawing.handleStageMouseMove}
                            onMouseUp={drawing.handleStageMouseUp}
                          />
                        </div>
                      )}
                  </div>
                ) : model ? (
                  <div className="h-full w-full">
                    <ModelUploadPreview
                      modelUploadId={model.modelUploadId}
                      modelPath={model.modelPath}
                      companyId={companyId}
                      pmiLinks={pmiLinks}
                      selectedLinkId={modelFeatureId}
                      onLinkSelect={setModelFeatureId}
                      className="h-full rounded-none"
                    />
                  </div>
                ) : null}
                {canUpdate &&
                  annotationDraft &&
                  annotationDraft.pageNumber === pdfViewPage &&
                  renderedWidth > 0 &&
                  overlayHeight > 0 && (
                    <AnnotationPopover
                      draft={annotationDraft}
                      renderedWidth={renderedWidth}
                      overlayHeight={overlayHeight}
                      fontSizeInput={drawing.annotationFontSizeInput}
                      onFontSizeInputChange={drawing.setAnnotationFontSizeInput}
                      onDraftChange={(patch) =>
                        drawing.setAnnotationDraft((prev) =>
                          prev ? { ...prev, ...patch } : prev
                        )
                      }
                      onCancel={drawing.cancelAnnotationDraft}
                      onSubmit={() => void drawing.handleCreateAnnotation()}
                    />
                  )}
                {canUpdate &&
                  !annotationDraft &&
                  annotationEditDraft &&
                  annotationEditDraft.pageNumber === pdfViewPage &&
                  renderedWidth > 0 &&
                  overlayHeight > 0 && (
                    <AnnotationPopover
                      draft={annotationEditDraft}
                      renderedWidth={renderedWidth}
                      overlayHeight={overlayHeight}
                      fontSizeInput={drawing.annotationEditFontSizeInput}
                      onFontSizeInputChange={
                        drawing.setAnnotationEditFontSizeInput
                      }
                      onDraftChange={(patch) =>
                        drawing.setAnnotationEditDraft((prev) =>
                          prev ? { ...prev, ...patch } : prev
                        )
                      }
                      onCancel={drawing.cancelAnnotationEdit}
                      onSubmit={() => void drawing.handleUpdateAnnotation()}
                      onDelete={() => void drawing.handleDeleteAnnotation()}
                    />
                  )}
              </div>
            </div>
          )}

          {onCharacteristics && hasDocument && featuresTableExpanded ? (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={t`Drag to resize diagram and characteristics`}
              aria-valuenow={Math.round(pdfPaneHeightPx)}
              className={`group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center rounded-md px-2 hover:bg-muted/80 pointer-coarse:h-6 pointer-coarse:hit-area ${
                splitResize.isResizing ? "bg-muted" : ""
              }`}
              {...splitResize.handleProps}
            >
              <span className="h-1 w-14 shrink-0 rounded-full bg-muted-foreground/40 group-hover:bg-muted-foreground/65" />
            </div>
          ) : null}

          {/* Features table — form fields map to balloon columns; autosaved */}
          <div
            className={cn(
              "flex min-w-0 flex-col overflow-hidden bg-card",
              tableFillsPane ? "min-h-0 flex-1" : "max-h-[14rem] shrink-0",
              hasDocument && "rounded-lg"
            )}
            style={
              onCharacteristics &&
              hasDocument &&
              featuresTableExpanded &&
              editorStackHeightPx > 0
                ? { minHeight: editorStackHeightPx * 0.5 }
                : undefined
            }
          >
            {(onCharacteristics ||
              (bottomTab === "parameters" && canUpdate)) && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
                {onCharacteristics && hasDocument && (
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={featuresTableExpanded}
                    aria-label={
                      featuresTableExpanded
                        ? t`Collapse characteristics table`
                        : t`Expand characteristics table`
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
                )}
                <div className="ml-auto flex items-center gap-2">
                  {onCharacteristics ? (
                    <>
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        leftIcon={<LuSlidersHorizontal className="h-4 w-4" />}
                        isDisabled={!canUpdate}
                        onClick={() => openSamplingModal("document")}
                      >
                        {samplingRuleSummary(docSampling) ?? t`Inspect All`}
                      </Button>
                      {canUpdate && (
                        <Button
                          size="sm"
                          type="button"
                          variant="secondary"
                          leftIcon={<LuPlus className="h-4 w-4" />}
                          onClick={handleAddFeature}
                        >
                          {t`Add Characteristic`}
                        </Button>
                      )}
                    </>
                  ) : (
                    canUpdate && (
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        leftIcon={<LuPlus className="h-4 w-4" />}
                        onClick={handleAddParameter}
                      >
                        {t`Add Parameter`}
                      </Button>
                    )
                  )}
                </div>
              </div>
            )}
            <div
              className={cn(
                tableFillsPane
                  ? "min-h-0 flex-1 overflow-auto"
                  : "overflow-auto",
                // A flush grid has no frame, so its last row closes it.
                !hasDocument &&
                  "[&_tbody>tr:last-child]:border-b [&_tbody>tr:last-child]:border-border"
              )}
            >
              {/* Keyed: Grid records its column order on mount, so one
                  instance reused across tabs would keep the other's order. */}
              {bottomTab === "characteristics" ? (
                <Grid<FeatureRow>
                  key="characteristics"
                  data={featureRows}
                  columns={featureColumns}
                  editableComponents={featureEditableComponents}
                  canEdit={canUpdate}
                  contained={!hasDocument}
                />
              ) : bottomTab === "parameters" ? (
                <Grid<ParameterRow>
                  key="parameters"
                  data={parameterRows}
                  columns={parameterColumns}
                  editableComponents={parameterEditableComponents}
                  canEdit={canUpdate}
                  contained={!hasDocument}
                />
              ) : (
                <InspectionDocumentWorkInstruction
                  key="instructions"
                  canUpdate={canUpdate}
                  workInstruction={workInstruction}
                  draft={workInstructionDraft}
                />
              )}
            </div>
          </div>
        </div>
        {!hasDocument && onCharacteristics && (
          <InspectionDocumentDropzone
            uploading={uploading || modelUpload.upload !== null}
            progress={modelUpload.upload}
            disabled={!canUpdate}
            onPdf={(file) =>
              void uploadPdfAndSave(file, { clearBalloons: false })
            }
            onModel={(file) => void handleModelUpload(file)}
          />
        )}
      </div>

      {samplingTarget !== null && (
        <SamplingRuleModal
          open={samplingModal.isOpen}
          context={samplingTarget === "document" ? "document" : "feature"}
          featureLabel={
            samplingTarget === "document"
              ? undefined
              : featureRows.find((r) => r.featureId === samplingTarget)?.label
          }
          standard={samplingStandard}
          initial={
            samplingTarget === "document"
              ? docSampling
              : (() => {
                  const row = featureRows.find(
                    (r) => r.featureId === samplingTarget
                  );
                  return {
                    samplingPlanType: row?.samplingPlanType ?? null,
                    samplingSampleSize: row?.samplingSampleSize ?? null,
                    samplingPercentage: row?.samplingPercentage ?? null,
                    samplingAql: row?.samplingAql ?? null,
                    samplingInspectionLevel:
                      row?.samplingInspectionLevel ?? null,
                    samplingSeverity: row?.samplingSeverity ?? null
                  };
                })()
          }
          inheritedRule={samplingTarget === "document" ? null : docSampling}
          onSave={(rule) => {
            if (samplingTarget === "document") {
              setDocSampling(rule);
            } else if (samplingTarget) {
              updateFeatureSampling(samplingTarget, rule);
            }
          }}
          onClose={samplingModal.close}
        />
      )}
    </div>
  );
}
