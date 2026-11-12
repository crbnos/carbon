// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, HStack, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuTrash2 } from "react-icons/lu";
import type { AnnotationDraft } from "./editorModel";

const ANNOTATION_DIALOG_WIDTH_PX = 220;
const ANNOTATION_DIALOG_HEIGHT_PX = 140;
const ANNOTATION_DIALOG_GAP_PX = 8;

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

type AnnotationPopoverProps = {
  /** The annotation being written (a new one) or edited. */
  draft: AnnotationDraft;
  renderedWidth: number;
  overlayHeight: number;
  /** The text size as typed; the draft holds the size it parses to. */
  fontSizeInput: string;
  onFontSizeInputChange: (value: string) => void;
  onDraftChange: (
    patch: Partial<Pick<AnnotationDraft, "text" | "fontSize">>
  ) => void;
  onCancel: () => void;
  onSubmit: () => void;
  /** Given when editing an annotation: shows Delete, and Update for Add. */
  onDelete?: () => void;
};

/** The text and size of an annotation, beside it on the drawing. */
export default function AnnotationPopover({
  draft,
  renderedWidth,
  overlayHeight,
  fontSizeInput,
  onFontSizeInputChange,
  onDraftChange,
  onCancel,
  onSubmit,
  onDelete
}: AnnotationPopoverProps) {
  const { t } = useLingui();
  const isEditing = onDelete !== undefined;

  const cancelButton = (
    <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
      {t`Cancel`}
    </Button>
  );
  const submitButton = (
    <Button type="button" size="sm" onClick={onSubmit}>
      {isEditing ? t`Update` : t`Add`}
    </Button>
  );

  return (
    <div
      className="absolute z-20 rounded-md border bg-background p-2 shadow-md"
      style={getAnnotationDialogPosition({
        renderedWidth,
        overlayHeight,
        totalPagesStage: 1,
        pageNumber: draft.pageNumber,
        x: draft.x,
        y: draft.y,
        width: draft.width,
        height: draft.height
      })}
    >
      <VStack spacing={2} className="w-52">
        <input
          aria-label={t`Annotation text`}
          className="h-8 w-full rounded border bg-background px-2 text-xs"
          placeholder={t`Annotation text`}
          value={draft.text}
          onChange={(event) => onDraftChange({ text: event.target.value })}
        />
        <input
          aria-label={t`Annotation text size`}
          type="text"
          inputMode="numeric"
          className="h-8 w-full rounded border bg-background px-2 text-xs"
          placeholder={t`Text size`}
          value={fontSizeInput}
          onChange={(event) => {
            const raw = event.target.value;
            if (!/^\d*$/.test(raw)) return;
            onFontSizeInputChange(raw);
            if (raw === "") return;
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) return;
            onDraftChange({ fontSize: Math.max(8, Math.min(48, parsed)) });
          }}
          onBlur={() => {
            const parsed = Number(fontSizeInput || "12");
            const normalized = Math.max(
              8,
              Math.min(48, Number.isFinite(parsed) ? parsed : 12)
            );
            onFontSizeInputChange(String(normalized));
            onDraftChange({ fontSize: normalized });
          }}
        />
        {isEditing ? (
          <HStack spacing={1} className="justify-between">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              leftIcon={<LuTrash2 />}
              onClick={onDelete}
            >
              {t`Delete`}
            </Button>
            <HStack spacing={1}>
              {cancelButton}
              {submitButton}
            </HStack>
          </HStack>
        ) : (
          <HStack spacing={1} className="justify-end">
            {cancelButton}
            {submitButton}
          </HStack>
        )}
      </VStack>
    </div>
  );
}
