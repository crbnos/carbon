// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CollectedValues,
  DocumentEditType,
  DocumentSettings
} from "@carbon/documents/template";
import { applyDocumentEdit } from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalTitle,
  Spinner,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuDownload, LuLock, LuRotateCcw } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { DOCUMENT_EDIT_RECORDS } from "~/modules/settings/settings.utils";

import type { loader as documentEditLoader } from "~/routes/api+/document-edit.$type.$id";
import { path } from "~/utils/path";
import { EditorPanes } from "./DocumentTemplateEditor";
import {
  changedNotes,
  DocumentTemplateProvider,
  useDocumentTemplate,
  useEditorStore
} from "./DocumentTemplateEditor/context";

const logger = getLogger("erp", "document-edit-modal");

/**
 * "Edit document": how one record's document prints (its words, hidden fields
 * and blocks, Terms and Notes), on top of the company template. Any page opens
 * it with the record's document type and id.
 */
export default function DocumentEditModal({
  documentType,
  documentId,
  onClose
}: {
  documentType: DocumentEditType;
  documentId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof documentEditLoader>();
  const actionPath = path.to.api.documentEdit(documentType, documentId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once, as the modal opens.
  useEffect(() => {
    fetcher.load(actionPath);
  }, [actionPath]);

  const result = fetcher.data;
  const editor = result?.data ?? null;
  const printed = editor && applyDocumentEdit(editor.template, editor.edit);

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent
        size="xxxlarge"
        // Once the editor is open, Cancel is the way out, so a stray Escape or
        // click cannot lose a draft. Until then, the X is the only way out.
        withCloseButton={!editor}
        onEscapeKeyDown={(e) => {
          if (editor) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (editor) e.preventDefault();
        }}
        className="flex h-[90dvh] max-w-[min(96vw,1600px)] flex-col gap-0 overflow-hidden p-0"
      >
        {!editor || !printed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            <ModalTitle className="sr-only">{t`Edit document`}</ModalTitle>
            {result?.error ? (
              <p className="text-sm text-destructive">{result.error.message}</p>
            ) : (
              <Spinner className="size-6" />
            )}
          </div>
        ) : (
          <DocumentTemplateProvider
            key={`${documentType}:${documentId}`}
            documentType={documentType}
            actionPath={actionPath}
            initialBlocks={printed.blocks}
            initialTheme={editor.template.theme}
            initialSettings={printed.settings as DocumentSettings}
            initialHeaderSectionId={editor.template.headerSectionId ?? null}
            initialFooterSectionId={editor.template.footerSectionId ?? null}
            sections={[]}
            customFields={[]}
            previewEntities={[]}
            termsSeed={
              (editor.termsSeed ?? undefined) as JSONContent | undefined
            }
            hasWatermark={false}
            document={{
              id: documentId,
              label: editor.label,
              locked: editor.locked,
              hasNotes:
                DOCUMENT_EDIT_RECORDS[documentType].notesColumn !== null,
              template: {
                blocks: editor.template.blocks,
                settings: editor.template.settings as DocumentSettings
              }
            }}
            initialNotes={editor.notes as JSONContent | null}
            onSaved={({ notesChanged }) => {
              // The record's page keeps its own copy of the notes and saves it
              // on the next keystroke, which would overwrite these. Reloading
              // is the one way that works on every record's page.
              if (notesChanged) navigate(0);
              else onClose();
            }}
          >
            <DocumentValuesLoader
              path={path.to.api.documentEditValues(documentType, documentId)}
            />
            <DocumentEditBar
              onCancel={onClose}
              previewPath={path.to.api.documentEditPreview(
                documentType,
                documentId
              )}
            />
            <div className="flex min-h-0 flex-1 flex-col">
              <EditorPanes actionPath={actionPath} />
            </div>
          </DocumentTemplateProvider>
        )}
      </ModalContent>
    </Modal>
  );
}

/**
 * Reads the record's own values once, for the pencils. A plain fetch, because a
 * fetcher's failure replaces the whole page with its error screen. Without the
 * values there are no pencils, and the words can still be edited.
 */
function DocumentValuesLoader({ path: valuesPath }: { path: string }) {
  const setDocumentValues = useEditorStore((s) => s.setDocumentValues);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(valuesPath, { signal: controller.signal });
        if (!response.ok) return;
        const values: { data: CollectedValues } = await response.json();
        setDocumentValues(values.data);
      } catch (error) {
        if (!controller.signal.aborted) logger.error("Error", { error });
      }
    })();
    return () => controller.abort();
  }, [valuesPath, setDocumentValues]);

  return null;
}

function DocumentEditBar({
  onCancel,
  previewPath
}: {
  onCancel: () => void;
  previewPath: string;
}) {
  const { t } = useLingui();
  const { save, refuseDraft, isSaving, isDirty, blocks, settings } =
    useDocumentTemplate();
  const document = useEditorStore((s) => s.document);
  const notes = useEditorStore(changedNotes);
  const resetToTemplate = useEditorStore((s) => s.resetToTemplate);
  const [isDownloading, setIsDownloading] = useState(false);
  if (!document) return null;
  const label = document.label;

  // Prints what is on screen, saved or not.
  const download = async () => {
    if (!document.locked && refuseDraft()) return;
    setIsDownloading(true);
    try {
      const formData = new FormData();
      formData.append("blocks", JSON.stringify(blocks));
      formData.append("settings", JSON.stringify(settings));
      formData.append("intent", "download");
      if (notes !== undefined) formData.append("notes", notes);
      const response = await fetch(previewPath, {
        method: "post",
        body: formData
      });
      if (!response.ok) {
        toast.error(await response.text());
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${label}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t`The document could not be downloaded.`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex min-h-14 flex-wrap items-center gap-3 border-b bg-card py-2 pr-4 pl-4">
      <div className="flex min-w-0 flex-col">
        <ModalTitle className="truncate text-sm font-semibold">
          <Trans>Editing {label} only</Trans>
        </ModalTitle>
        <ModalDescription className="truncate text-xs text-muted-foreground">
          {document.locked ? (
            <span className="inline-flex items-center gap-1">
              <LuLock className="size-3" />
              <Trans>Locked: this record can no longer change.</Trans>
            </span>
          ) : (
            <Trans>The company template stays the same.</Trans>
          )}
        </ModalDescription>
      </div>
      <div className="flex-1" />
      {!document.locked && (
        <Button
          variant="ghost"
          leftIcon={<LuRotateCcw />}
          onClick={resetToTemplate}
          isDisabled={isSaving}
        >
          <Trans>Reset to template</Trans>
        </Button>
      )}
      <Button
        variant="secondary"
        leftIcon={<LuDownload />}
        onClick={download}
        isLoading={isDownloading}
      >
        <Trans>Download</Trans>
      </Button>
      <Button variant="secondary" onClick={onCancel}>
        {document.locked ? t`Close` : t`Cancel`}
      </Button>
      {!document.locked && (
        <Button onClick={save} isLoading={isSaving} isDisabled={!isDirty}>
          <Trans>Save</Trans>
        </Button>
      )}
    </div>
  );
}
