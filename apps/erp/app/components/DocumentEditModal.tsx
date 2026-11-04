// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  DocumentEditType,
  DocumentSettings
} from "@carbon/documents/template";
import { applyDocumentEdit } from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  Modal,
  ModalContent,
  ModalDescription,
  ModalTitle,
  Spinner
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useState } from "react";
import { LuFilePen, LuLock, LuRotateCcw } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { DOCUMENT_EDIT_RECORDS } from "~/modules/settings/settings.models";
import type { loader as documentEditLoader } from "~/routes/api+/document-edit.$type.$id";
import { path } from "~/utils/path";
import { EditorPanes } from "./DocumentTemplateEditor";
import {
  DocumentTemplateProvider,
  useDocumentTemplate,
  useEditorStore
} from "./DocumentTemplateEditor/context";

/**
 * "Edit document": how one record's document prints (its words, hidden fields
 * and blocks, Terms and Notes), on top of the company template. Any page opens
 * it with the record's document type and id.
 */
export function DocumentEditModal({
  documentType,
  documentId,
  open,
  onClose
}: {
  documentType: DocumentEditType;
  documentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof documentEditLoader>();
  const actionPath = path.to.api.documentEdit(documentType, documentId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once each time the modal opens.
  useEffect(() => {
    if (open) fetcher.load(actionPath);
  }, [open, actionPath]);

  const result = fetcher.data;
  const editor = result?.data ?? null;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent
        size="xxxlarge"
        className="flex h-[90dvh] max-w-[min(96vw,1600px)] flex-col gap-0 overflow-hidden p-0"
      >
        {!editor ? (
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
            initialBlocks={
              applyDocumentEdit(editor.template, editor.edit).blocks
            }
            initialTheme={editor.template.theme}
            initialSettings={
              applyDocumentEdit(editor.template, editor.edit)
                .settings as DocumentSettings
            }
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
            onSaved={onClose}
          >
            <DocumentEditBar onCancel={onClose} />
            <div className="flex min-h-0 flex-1 flex-col">
              <EditorPanes actionPath={actionPath} />
            </div>
          </DocumentTemplateProvider>
        )}
      </ModalContent>
    </Modal>
  );
}

function DocumentEditBar({ onCancel }: { onCancel: () => void }) {
  const { t } = useLingui();
  const { save, isSaving, isDirty } = useDocumentTemplate();
  const document = useEditorStore((s) => s.document);
  const resetToTemplate = useEditorStore((s) => s.resetToTemplate);
  if (!document) return null;
  const label = document.label;

  return (
    <div className="flex min-h-14 flex-wrap items-center gap-3 border-b bg-card py-2 pr-14 pl-4">
      <div className="flex min-w-0 flex-col">
        <ModalTitle className="truncate text-sm font-semibold">
          <Trans>Editing {label} only</Trans>
        </ModalTitle>
        <ModalDescription className="truncate text-xs text-muted-foreground">
          {document.locked ? (
            <span className="inline-flex items-center gap-1">
              <LuLock className="size-3" />
              <Trans>Locked: this document was sent.</Trans>
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

/**
 * "Edit document" for a record's menu: whether the user may edit it, the
 * function that opens the modal, and the modal to render outside the menu (a
 * dropdown unmounts its items when it closes).
 */
export function useDocumentEditModal(
  documentType: DocumentEditType,
  documentId: string | undefined
): { canEdit: boolean; openEditor: () => void; modal: ReactNode } {
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);
  const canEdit =
    Boolean(documentId) &&
    permissions.can("update", DOCUMENT_EDIT_RECORDS[documentType].module);

  return {
    canEdit,
    openEditor: () => setOpen(true),
    modal:
      canEdit && documentId ? (
        <DocumentEditModal
          documentType={documentType}
          documentId={documentId}
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null
  };
}

/** The "Edit document" item next to a record's "PDF" item. */
export function EditDocumentMenuItem({ onSelect }: { onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <DropdownMenuIcon icon={<LuFilePen />} />
      <Trans>Edit document</Trans>
    </DropdownMenuItem>
  );
}
