// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck, LuTicketX, LuTrash } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import MemoStatus from "./MemoStatus";

type Memo = Database["public"]["Tables"]["memo"]["Row"];

const MemoHeader = () => {
  const { t } = useLingui();
  const { memoId } = useParams();
  if (!memoId) throw new Error("memoId not found");

  const routeData = useRouteData<{ memo: Memo }>(path.to.memo(memoId));

  const permissions = usePermissions();
  const post = useFetcher();
  const voidModal = useDisclosure();
  const deleteModal = useDisclosure();

  const memo = routeData?.memo;
  if (!memo) throw new Error("Could not find memo in routeData");

  const status = memo.status;
  const isDraft = status === "Draft";
  const isPosted = status === "Posted";
  const canMutate = permissions.can("update", "invoicing");
  const canDelete = permissions.can("delete", "invoicing");
  // The party decides which list the memo lives in, and what it is called.
  const typeLabel = memo.supplierId ? t`Supplier Credit` : t`Credit Memo`;

  return (
    <>
      <DocumentPageHeader
        title={memo.memoId}
        status={
          <>
            <Enumerable value={typeLabel} />
            <MemoStatus status={status} />
          </>
        }
        meta={[
          <Trans key="created">
            Created <DateTime value={memo.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={memo.createdBy} />
          </Trans>,
          memo.postingDate ? (
            memo.postedBy ? (
              <Trans key="posted">
                Posted <DateTime value={memo.postingDate} variant="date" /> by{" "}
                <EmployeeAvatar employeeId={memo.postedBy} />
              </Trans>
            ) : (
              <Trans key="posted">
                Posted <DateTime value={memo.postingDate} variant="date" />
              </Trans>
            )
          ) : null,
          memo.voidedAt ? (
            memo.voidedBy ? (
              <Trans key="voided">
                Voided <DateTime value={memo.voidedAt} variant="date" /> by{" "}
                <EmployeeAvatar employeeId={memo.voidedBy} />
              </Trans>
            ) : (
              <Trans key="voided">
                Voided <DateTime value={memo.voidedAt} variant="date" />
              </Trans>
            )
          ) : null
        ]}
        menuItems={
          isPosted ? (
            <DropdownMenuItem
              disabled={!canMutate}
              destructive
              onClick={voidModal.onOpen}
            >
              <DropdownMenuIcon icon={<LuTicketX />} />
              <Trans>Void</Trans>
            </DropdownMenuItem>
          ) : isDraft ? (
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              disabled={!canDelete}
              destructive
              onClick={deleteModal.onOpen}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete Memo</Trans>
            </DropdownMenuItem>
          ) : undefined
        }
        actions={
          isDraft ? (
            <Button
              leftIcon={<LuCheckCheck />}
              variant="primary"
              isLoading={post.state !== "idle"}
              isDisabled={!canMutate}
              onClick={() =>
                post.submit(null, {
                  method: "post",
                  action: path.to.memoPost(memo.id)
                })
              }
            >
              <Trans>Post</Trans>
            </Button>
          ) : undefined
        }
      />

      {voidModal.isOpen && (
        <ConfirmDelete
          action={path.to.memoVoid(memo.id)}
          name={memo.memoId}
          title={t`Void ${memo.memoId}`}
          text={t`Are you sure you want to void this memo? This will reverse its accounting entries and applications. This cannot be undone.`}
          deleteText={t`Void`}
          onCancel={voidModal.onClose}
          onSubmit={voidModal.onClose}
        />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.memoDelete(memo.id)}
          isOpen={deleteModal.isOpen}
          name={memo.memoId}
          text={t`Are you sure you want to delete ${memo.memoId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
    </>
  );
};

export default MemoHeader;
