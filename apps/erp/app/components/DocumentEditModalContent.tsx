// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
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
import { useEffect, useRef, useState } from "react";
import { LuDownload, LuLock, LuRotateCcw } from "react-icons/lu";
import { useNavigate } from "react-router";
import { DOCUMENT_EDIT_RECORDS } from "~/modules/settings/settings.utils";

import type { loader as documentEditLoader } from "~/routes/api+/document-edit.$type.$id";
import { path } from "~/utils/path";
import { EditorPanes } from "./DocumentTemplateEditor";
import {
  changedNotes,
  DocumentTemplateProvider,
  useDocumentTemplate,
  useEditorStore,
  useIsDirty,
  useLoadPrintedValues
} from "./DocumentTemplateEditor/context";

const logger = getLogger("erp", "document-edit-modal");

type DocumentEditor = NonNullable<
  Awaited<ReturnType<typeof documentEditLoader>>["data"]["data"]
>;

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
  const actionPath = path.to.api.documentEdit(documentType, documentId);
  const { editor, error } = useDocumentEditor(actionPath);
  // The record's page keeps its own copy of the notes and saves it on the next
  // keystroke, which would overwrite these. Reloading is the one way that works on
  // every record's page.
  const notesSaved = useRef(false);
  const close = () => {
    if (notesSaved.current) navigate(0);
    else onClose();
  };
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
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
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
            sections={editor.sections}
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
            onSaved={({ notesChanged, stillEditing }) => {
              notesSaved.current ||= notesChanged;
              if (!stillEditing) close();
            }}
          >
            <DocumentValuesLoader
              path={path.to.api.documentEditValues(documentType, documentId)}
            />
            <DocumentEditBar
              onCancel={close}
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

/** Reads the record's own values once, for the pencils and the preview's clicks. */
function DocumentValuesLoader({ path: valuesPath }: { path: string }) {
  useLoadPrintedValues(valuesPath);
  return null;
}

/**
 * Loads the editor once, as the modal opens. A plain fetch: a fetcher would replace
 * the page with its error screen on a failure, and reload after a save, which
 * could take the draft away.
 */
function useDocumentEditor(actionPath: string) {
  const { t } = useLingui();
  const [state, setState] = useState<{
    editor: DocumentEditor | null;
    error: string | null;
  }>({ editor: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    const failed = t`The document could not be opened.`;
    (async () => {
      try {
        const response = await fetch(actionPath, { signal: controller.signal });
        const result: { data?: DocumentEditor; error?: { message: string } } =
          response.ok ? await response.json() : { error: { message: failed } };
        setState({
          editor: result.data ?? null,
          error: result.data ? null : (result.error?.message ?? failed)
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.error("Failed to load the document editor", { error });
        setState({ editor: null, error: failed });
      }
    })();
    return () => controller.abort();
  }, [actionPath, t]);

  return state;
}

function DocumentEditBar({
  onCancel,
  previewPath
}: {
  onCancel: () => void;
  previewPath: string;
}) {
  const { t } = useLingui();
  const { save, refuseDraft, isSaving, blocks, settings } =
    useDocumentTemplate();
  const isDirty = useIsDirty();
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
      <Button variant="secondary" onClick={onCancel} isDisabled={isSaving}>
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
