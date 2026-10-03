// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck, LuRotateCcw, LuSave, LuTrash } from "react-icons/lu";
import { useNavigation, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import type { JournalEntry } from "~/modules/accounting";
import { path } from "~/utils/path";
import { journalEntryFormId, useJournalEntryCanPost } from "./JournalEntryForm";
import JournalEntryStatus from "./JournalEntryStatus";

const JournalEntryHeader = () => {
  const { t } = useLingui();
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("journalEntryId not found");

  const routeData = useRouteData<{ journalEntry: JournalEntry }>(
    path.to.journalEntry(journalEntryId)
  );

  const permissions = usePermissions();
  const navigation = useNavigation();
  const reverseModal = useDisclosure();
  const deleteModal = useDisclosure();
  // The lines are edited in the form; it reports whether they balance.
  const canPost = useJournalEntryCanPost(journalEntryId);

  const journalEntry = routeData?.journalEntry;
  if (!journalEntry)
    throw new Error("Could not find journal entry in routeData");

  const status = journalEntry.status;
  const isDraft = status === "Draft";
  const isPosted = status === "Posted";

  const canReverse = isPosted && permissions.can("create", "accounting");

  return (
    <>
      <DocumentPageHeader
        title={journalEntry.journalEntryId}
        status={<JournalEntryStatus status={status} />}
        meta={[
          journalEntry.createdBy ? (
            <Trans key="created">
              Created{" "}
              <DateTime value={journalEntry.createdAt} variant="relative" /> by{" "}
              <EmployeeAvatar employeeId={journalEntry.createdBy} />
            </Trans>
          ) : (
            <Trans key="created">
              Created{" "}
              <DateTime value={journalEntry.createdAt} variant="relative" />
            </Trans>
          ),
          isDraft ? null : journalEntry.postedBy ? (
            <Trans key="posted">
              Posted{" "}
              <DateTime value={journalEntry.postingDate} variant="date" /> by{" "}
              <EmployeeAvatar employeeId={journalEntry.postedBy} />
            </Trans>
          ) : (
            <Trans key="posted">
              Posted{" "}
              <DateTime value={journalEntry.postingDate} variant="date" />
            </Trans>
          )
        ]}
        menuItems={
          canReverse || isDraft ? (
            <>
              {canReverse && (
                <DropdownMenuItem destructive onClick={reverseModal.onOpen}>
                  <DropdownMenuIcon icon={<LuRotateCcw />} />
                  <Trans>Reverse Entry</Trans>
                </DropdownMenuItem>
              )}
              {isDraft && (
                <DropdownMenuItem
                  disabled={
                    !permissions.can("delete", "accounting") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Journal Entry</Trans>
                </DropdownMenuItem>
              )}
            </>
          ) : undefined
        }
        actions={
          isDraft &&
          permissions.can("update", "accounting") && (
            <>
              {/* Both submit the lines form below by its id. */}
              <Button
                type="submit"
                form={journalEntryFormId}
                name="intent"
                value="save"
                variant="secondary"
                leftIcon={<LuSave />}
                isLoading={
                  navigation.state !== "idle" &&
                  navigation.formData?.get("intent") === "save"
                }
              >
                <Trans>Save Draft</Trans>
              </Button>
              {/* Saves the form's lines, then posts them. */}
              <Button
                type="submit"
                form={journalEntryFormId}
                name="intent"
                value="post"
                variant="primary"
                leftIcon={<LuCheckCheck />}
                isDisabled={!canPost}
                isLoading={
                  navigation.state !== "idle" &&
                  navigation.formData?.get("intent") === "post"
                }
              >
                <Trans>Post</Trans>
              </Button>
            </>
          )
        }
      />

      {reverseModal.isOpen && (
        <ConfirmDelete
          action={path.to.reverseJournalEntry(journalEntryId)}
          isOpen={reverseModal.isOpen}
          name={journalEntry.journalEntryId}
          title={t`Reverse ${journalEntry.journalEntryId}`}
          deleteText={t`Reverse Entry`}
          text={t`Are you sure you want to reverse this journal entry? This will create a new posted entry with negated amounts and mark this entry as Reversed.`}
          onCancel={reverseModal.onClose}
          onSubmit={reverseModal.onClose}
        />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteJournalEntry(journalEntryId)}
          isOpen={deleteModal.isOpen}
          name={journalEntry.journalEntryId}
          text={t`Are you sure you want to delete ${journalEntry.journalEntryId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
    </>
  );
};

export default JournalEntryHeader;
