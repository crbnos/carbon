// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import type {
  AnnotationDraft,
  AnnotationEditDraft,
  AnnotationRecord
} from "./editorModel";

type UseDrawingAnnotationsArgs = {
  /** The annotation clicked on the drawing; its edit draft follows it. */
  selectedAnnotationId: string | null;
  setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
};

/**
 * Text annotations on the drawing: the ones placed, the one being written
 * (`annotationDraft`) and the one being edited (`annotationEditDraft`). They
 * are kept in the browser only.
 */
export function useDrawingAnnotations({
  selectedAnnotationId,
  setSelectedAnnotationId
}: UseDrawingAnnotationsArgs) {
  const { t } = useLingui();
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [annotationDraft, setAnnotationDraft] =
    useState<AnnotationDraft | null>(null);
  const [annotationFontSizeInput, setAnnotationFontSizeInput] =
    useState<string>("12");
  const [annotationEditDraft, setAnnotationEditDraft] =
    useState<AnnotationEditDraft | null>(null);
  const [annotationEditFontSizeInput, setAnnotationEditFontSizeInput] =
    useState<string>("12");

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
  }, [annotationEditDraft, setSelectedAnnotationId, t]);

  const handleDeleteAnnotation = useCallback(async () => {
    if (!annotationEditDraft) return;
    setAnnotations((prev) =>
      prev.filter((item) => item.id !== annotationEditDraft.id)
    );
    setSelectedAnnotationId(null);
    setAnnotationEditDraft(null);
    toast.success(t`Annotation deleted`);
  }, [annotationEditDraft, setSelectedAnnotationId, t]);

  const cancelAnnotationDraft = useCallback(() => {
    setAnnotationDraft(null);
    setAnnotationFontSizeInput("12");
  }, []);

  const cancelAnnotationEdit = useCallback(() => {
    setSelectedAnnotationId(null);
    setAnnotationEditDraft(null);
  }, [setSelectedAnnotationId]);

  return {
    annotations,
    setAnnotations,
    annotationDraft,
    setAnnotationDraft,
    annotationFontSizeInput,
    setAnnotationFontSizeInput,
    annotationEditDraft,
    setAnnotationEditDraft,
    annotationEditFontSizeInput,
    setAnnotationEditFontSizeInput,
    handleCreateAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    cancelAnnotationDraft,
    cancelAnnotationEdit
  };
}
