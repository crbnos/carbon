// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { serviceErrorMessage } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useFetcher } from "react-router";
import type { action as saveAction } from "~/routes/x+/inspection-document+/$id.save";
import { path } from "~/utils/path";
import {
  AUTOSAVE_DELAY_MS,
  hasUnsavedRows,
  mergeSaveResponse,
  type ParameterRow
} from "./autosave";
import {
  BALLOON_H_PCT,
  BALLOON_W_PCT,
  buildFeatureRowsFromLoader,
  type DragKind,
  type FeatureRow,
  getBalloonValueOrNull,
  type PdfMetrics,
  type SelectorRect,
  selectorRectsFromBalloonRecords
} from "./editorModel";
import type { SamplingRule } from "./SamplingRuleModal";

/** What a save sent, so its response can tell what changed since. */
type SaveSnapshot = {
  featureRows: FeatureRow[];
  anchorRects: SelectorRect[];
  docSampling: SamplingRule;
  parameterRows: ParameterRow[];
  /** The parameters payload the save sent; null when it sent none. */
  parameters: string | null;
  pdfUrl: string;
  sentPdfMetrics: boolean;
  /** Characteristic and balloon ids this save creates. */
  createdIds: string[];
  featureDeleteIds: string[];
  balloonDeleteIds: string[];
};

/**
 * Which rows the server has: the ids minted here that no save has created
 * yet, the deletes still to send, and the save in flight. The drawing and the
 * row actions write to it; the autosave reads it.
 */
export type SaveLedger = {
  /** Characteristic and balloon ids minted here that no save has created
   * yet. A save sends these as creates, everything else as updates. */
  unsavedIdsRef: MutableRefObject<Set<string>>;
  /** Persisted feature ids to hard-delete on the next save. */
  pendingFeatureDeleteIdsRef: MutableRefObject<Set<string>>;
  /** Persisted balloon ids to hard-delete on the next save (unballoon). */
  pendingBalloonDeleteIdsRef: MutableRefObject<Set<string>>;
  /** The save in flight; null when none is. */
  inFlightSaveRef: MutableRefObject<SaveSnapshot | null>;
  isUnsaved: (id: string) => boolean;
  /** Queues a delete for a row the server has — or is creating right now —
   * and simply forgets one that never left the browser. */
  queueDelete: (pending: Set<string>, id: string) => void;
};

export function useSaveLedger(): SaveLedger {
  const unsavedIdsRef = useRef(new Set<string>());
  const pendingFeatureDeleteIdsRef = useRef(new Set<string>());
  const pendingBalloonDeleteIdsRef = useRef(new Set<string>());
  const inFlightSaveRef = useRef<SaveSnapshot | null>(null);
  const isUnsaved = useCallback(
    (id: string) => unsavedIdsRef.current.has(id),
    []
  );
  const queueDelete = useCallback((pending: Set<string>, id: string) => {
    const sending = inFlightSaveRef.current?.createdIds.includes(id);
    if (unsavedIdsRef.current.has(id) && !sending) {
      unsavedIdsRef.current.delete(id);
    } else {
      pending.add(id);
    }
  }, []);
  return {
    unsavedIdsRef,
    pendingFeatureDeleteIdsRef,
    pendingBalloonDeleteIdsRef,
    inFlightSaveRef,
    isUnsaved,
    queueDelete
  };
}

type FeaturePayload = {
  id: string;
  pageNumber: number;
  label: string;
  description: string | null;
  nominalValue: string | null;
  tolerancePlus: string | null;
  toleranceMinus: string | null;
  unit: string | null;
  type: FeatureRow["type"];
  samplingPlanType: FeatureRow["samplingPlanType"];
  samplingSampleSize: number | null;
  samplingPercentage: number | null;
  samplingAql: number | null;
  samplingInspectionLevel: FeatureRow["samplingInspectionLevel"];
  samplingSeverity: FeatureRow["samplingSeverity"];
  gaugeTypeId: string | null;
};

function featurePayload(r: FeatureRow): FeaturePayload {
  return {
    id: r.featureId,
    pageNumber: r.pageNumber,
    label: r.label,
    description: r.featureName.trim() || null,
    nominalValue: getBalloonValueOrNull(r.nominalValue),
    tolerancePlus: getBalloonValueOrNull(r.tolerancePlus),
    toleranceMinus: getBalloonValueOrNull(r.toleranceMinus),
    unit: getBalloonValueOrNull(r.units),
    type: r.type,
    samplingPlanType: r.samplingPlanType,
    samplingSampleSize: r.samplingSampleSize,
    samplingPercentage: r.samplingPercentage,
    samplingAql: r.samplingAql,
    samplingInspectionLevel: r.samplingInspectionLevel,
    samplingSeverity: r.samplingSeverity,
    gaugeTypeId: r.gaugeTypeId
  };
}

type UseInspectionDocumentAutosaveArgs = {
  diagramId: string;
  name: string;
  canUpdate: boolean;
  ledger: SaveLedger;
  featureRows: FeatureRow[];
  setFeatureRows: Dispatch<SetStateAction<FeatureRow[]>>;
  anchorRects: SelectorRect[];
  setSelectorRects: Dispatch<SetStateAction<SelectorRect[]>>;
  docSampling: SamplingRule;
  parameterRows: ParameterRow[];
  parametersPayload: string;
  pdfUrl: string;
  pdfMetrics: PdfMetrics | null;
  /** A replaced drawing's page metrics still need saving once it renders. */
  pdfMetricsDirty: boolean;
  setPdfMetricsDirty: Dispatch<SetStateAction<boolean>>;
  /** A PDF upload or a drag in progress holds the save back. */
  uploading: boolean;
  dragKind: DragKind;
};

/**
 * Every edit saves itself once the editor has been quiet for a moment — a
 * drag saves when it ends, and one save at a time: an edit made while a save
 * is in flight is picked up when it returns. Someone without update
 * permission can still look around, but nothing they change is saved.
 * Leaving with unsaved changes saves them first, then continues; only a
 * failed save asks (`isLeaving && saveFailed`).
 *
 * The saved sampling, PDF and parameters are what the editor held on its
 * first render, the loader's values.
 */
export function useInspectionDocumentAutosave({
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
  dragKind
}: UseInspectionDocumentAutosaveArgs) {
  const { t } = useLingui();
  const {
    unsavedIdsRef,
    pendingFeatureDeleteIdsRef,
    pendingBalloonDeleteIdsRef,
    inFlightSaveRef,
    isUnsaved
  } = ledger;
  const fetcher = useFetcher<typeof saveAction>();
  /** The save response last merged — the merge effect also runs on edits. */
  const handledSaveDataRef = useRef<unknown>(null);
  /** The last autosave that failed — not retried until something changes. */
  const failedSaveRef = useRef<SaveSnapshot | null>(null);
  const savedSamplingRef = useRef<SamplingRule>(docSampling);
  const savedPdfUrlRef = useRef(pdfUrl);
  const savedParametersRef = useRef(parametersPayload);
  /** Set by a PDF replace that cleared the balloons: toast once it saves. */
  const pdfReplaceToastRef = useRef(false);
  /** Whether a save has succeeded yet — the label shows nothing before. */
  const [hasSaved, setHasSaved] = useState(false);

  // Merges each save response into the editor's current state. It reads the
  // current rows, so it also runs on every edit; handledSaveDataRef makes each
  // response merge exactly once.
  useEffect(() => {
    const result = fetcher.data;
    if (!result || result === handledSaveDataRef.current) return;
    handledSaveDataRef.current = result;
    const sent = inFlightSaveRef.current;
    inFlightSaveRef.current = null;
    if (!sent) return;

    // A refused save, or a payload the route could not read (field errors).
    const data = "data" in result ? result.data : null;
    if (!data?.success) {
      failedSaveRef.current = sent;
      pdfReplaceToastRef.current = false;
      toast.error(
        serviceErrorMessage(result) ?? t`Failed to save inspection plan`
      );
      return;
    }

    const savedBalloons = data.balloons ?? [];
    const merged = mergeSaveResponse({
      sentRows: sent.featureRows,
      sentAnchors: sent.anchorRects,
      currentRows: featureRows,
      currentAnchors: anchorRects,
      savedRows: buildFeatureRowsFromLoader(data.features ?? [], savedBalloons),
      savedAnchors: selectorRectsFromBalloonRecords(savedBalloons)
    });

    for (const id of sent.createdIds) unsavedIdsRef.current.delete(id);
    for (const id of sent.featureDeleteIds) {
      pendingFeatureDeleteIdsRef.current.delete(id);
    }
    for (const id of sent.balloonDeleteIds) {
      pendingBalloonDeleteIdsRef.current.delete(id);
    }
    savedSamplingRef.current = sent.docSampling;
    if (sent.parameters !== null) savedParametersRef.current = sent.parameters;
    savedPdfUrlRef.current = sent.pdfUrl;
    failedSaveRef.current = null;
    if (sent.sentPdfMetrics) setPdfMetricsDirty(false);
    setFeatureRows(merged.rows);
    setSelectorRects(merged.anchors);
    setHasSaved(true);

    if (pdfReplaceToastRef.current && sent.pdfUrl === pdfUrl) {
      pdfReplaceToastRef.current = false;
      toast.success(
        t`Drawing replaced. Balloon placements were removed; characteristic rows are unchanged.`
      );
    }
  }, [
    fetcher.data,
    featureRows,
    anchorRects,
    pdfUrl,
    t,
    inFlightSaveRef,
    unsavedIdsRef,
    pendingFeatureDeleteIdsRef,
    pendingBalloonDeleteIdsRef,
    setPdfMetricsDirty,
    setFeatureRows,
    setSelectorRects
  ]);

  const { submit: submitSave } = fetcher;
  const saveChanges = useCallback(() => {
    const featureDeleteIds = [...pendingFeatureDeleteIdsRef.current];
    const balloonDeleteIds = [...pendingBalloonDeleteIdsRef.current];
    const formData = new FormData();
    formData.set("name", name);
    if (pdfUrl) formData.set("pdfUrl", pdfUrl);
    const featuresCreate = featureRows
      .filter((r) => isUnsaved(r.featureId))
      .map(featurePayload);

    const featuresUpdate = featureRows
      .filter(
        (r) =>
          !isUnsaved(r.featureId) &&
          (r.featureDirty || (r.geometryDirty && r.balloonId != null))
      )
      .map(featurePayload);

    formData.set(
      "features",
      JSON.stringify({
        create: featuresCreate,
        update: featuresUpdate,
        delete: featureDeleteIds
      })
    );

    const balloonsCreate = featureRows
      .filter(
        (r): r is FeatureRow & { balloonId: string } =>
          r.balloonId != null && isUnsaved(r.balloonId)
      )
      .map((r) => {
        const anchor = anchorRects.find((s) => s.id === r.balloonAnchorId);
        return {
          id: r.balloonId,
          inspectionFeatureId: r.featureId,
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
      (r) => r.balloonId && !isUnsaved(r.balloonId) && r.geometryDirty
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
        delete: balloonDeleteIds
      })
    );

    if (pdfMetrics) {
      formData.set("pageCount", String(pdfMetrics.pageCount));
      formData.set("defaultPageWidth", String(pdfMetrics.defaultPageWidth));
      formData.set("defaultPageHeight", String(pdfMetrics.defaultPageHeight));
    }
    formData.set("samplingDefault", JSON.stringify(docSampling));
    const sendParameters = parametersPayload !== savedParametersRef.current;
    if (sendParameters) formData.set("parameters", parametersPayload);
    inFlightSaveRef.current = {
      featureRows,
      anchorRects,
      docSampling,
      parameterRows,
      parameters: sendParameters ? parametersPayload : null,
      pdfUrl,
      sentPdfMetrics: pdfMetrics != null,
      createdIds: [
        ...featuresCreate.map((f) => f.id),
        ...balloonsCreate.map((b) => b.id)
      ],
      featureDeleteIds,
      balloonDeleteIds
    };
    submitSave(formData, {
      method: "post",
      action: path.to.saveInspectionDocument(diagramId)
    });
  }, [
    diagramId,
    name,
    pdfUrl,
    anchorRects,
    featureRows,
    pdfMetrics,
    docSampling,
    parameterRows,
    parametersPayload,
    submitSave,
    isUnsaved,
    inFlightSaveRef,
    pendingFeatureDeleteIdsRef,
    pendingBalloonDeleteIdsRef
  ]);

  const isSaving = fetcher.state !== "idle";
  const hasUnsavedChanges =
    canUpdate &&
    (hasUnsavedRows(featureRows, anchorRects, isUnsaved) ||
      pendingFeatureDeleteIdsRef.current.size > 0 ||
      pendingBalloonDeleteIdsRef.current.size > 0 ||
      pdfUrl !== savedPdfUrlRef.current ||
      (pdfMetricsDirty && pdfMetrics != null) ||
      JSON.stringify(docSampling) !==
        JSON.stringify(savedSamplingRef.current) ||
      parametersPayload !== savedParametersRef.current);
  const failedSave = failedSaveRef.current;
  const saveFailed =
    failedSave != null &&
    failedSave.featureRows === featureRows &&
    failedSave.anchorRects === anchorRects &&
    failedSave.docSampling === docSampling &&
    failedSave.parameterRows === parameterRows &&
    failedSave.pdfUrl === pdfUrl;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (hasUnsavedChanges || isSaving) &&
      currentLocation.pathname !== nextLocation.pathname
  );
  const isLeaving = blocker.state === "blocked";

  useEffect(() => {
    if (!hasUnsavedChanges || isSaving || uploading || saveFailed) return;
    if (dragKind !== null) return;
    const timer = setTimeout(saveChanges, isLeaving ? 0 : AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    hasUnsavedChanges,
    isSaving,
    uploading,
    saveFailed,
    dragKind,
    isLeaving,
    saveChanges
  ]);

  useEffect(() => {
    if (isLeaving && !hasUnsavedChanges && !isSaving) blocker.proceed?.();
  }, [blocker, isLeaving, hasUnsavedChanges, isSaving]);

  useEffect(() => {
    if (!hasUnsavedChanges && !isSaving) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges, isSaving]);

  return {
    isSaving,
    hasUnsavedChanges,
    saveFailed,
    hasSaved,
    blocker,
    isLeaving,
    pdfReplaceToastRef
  };
}
