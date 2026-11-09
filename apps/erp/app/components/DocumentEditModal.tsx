// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentEditType } from "@carbon/documents/template";
import {
  DropdownMenuIcon,
  DropdownMenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { lazy, type ReactNode, Suspense } from "react";
import { LuFilePen } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { DOCUMENT_EDIT_RECORDS } from "~/modules/settings/settings.utils";

// Lazy: every record page has this menu item, and few visits open the editor.
const DocumentEditModal = lazy(() => import("./DocumentEditModalContent"));

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
  const editor = useDisclosure();
  const canEdit =
    Boolean(documentId) &&
    permissions.can("update", DOCUMENT_EDIT_RECORDS[documentType].module);

  return {
    canEdit,
    openEditor: editor.onOpen,
    modal:
      canEdit && documentId && editor.openCount > 0 ? (
        <Suspense fallback={null}>
          <DocumentEditModal
            key={editor.openCount}
            documentType={documentType}
            documentId={documentId}
            open={editor.isOpen}
            onClose={editor.onClose}
          />
        </Suspense>
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
