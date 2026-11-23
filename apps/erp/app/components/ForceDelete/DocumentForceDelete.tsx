// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Hidden, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuShieldAlert, LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar } from "~/components";
import { Input, Submit, TextArea } from "~/components/Form";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { useUser } from "~/hooks";
import type { DocumentForceDeleteRequest } from "~/modules/invoicing/invoicing.service";
import {
  type ForceDeleteDocumentType,
  forceDeleteApprovalRefusal,
  forceDeleteRequestValidator
} from "~/modules/shared/shared.models";
import { path } from "~/utils/path";

/** What a document's page loads for the override. */
export type DocumentForceDeleteData = {
  isAdmin: boolean;
  forceDeleteRequest: DocumentForceDeleteRequest | null;
};

type DocumentRef = {
  documentType: ForceDeleteDocumentType;
  documentId: string;
  readableId: string;
  /** The document's status now: a posted one is voided first. */
  status: string;
};

function isPosted(status: string) {
  return status !== "Draft" && status !== "Voided";
}

/**
 * "Force Delete (Admin)" for a document header's menu: Admins only, disabled
 * while a request is open or the caller may not delete the document.
 */
export function DocumentForceDeleteMenuItem({
  forceDelete,
  canDelete,
  onClick
}: {
  forceDelete: DocumentForceDeleteData | undefined;
  canDelete: boolean;
  onClick: () => void;
}) {
  if (!forceDelete?.isAdmin) return null;
  return (
    <DropdownMenuItem
      disabled={!!forceDelete.forceDeleteRequest || !canDelete}
      destructive
      onClick={onClick}
    >
      <DropdownMenuIcon icon={<LuShieldAlert />} />
      <Trans>Force Delete (Admin)</Trans>
    </DropdownMenuItem>
  );
}

/**
 * Asks to force delete a purchase invoice, sales invoice, receipt or payment.
 * The warning says what the override does and what it never does; the Admin
 * types the document's number to confirm.
 */
export function DocumentForceDeleteModal({
  documentType,
  documentId,
  readableId,
  status,
  open,
  onClose
}: DocumentRef & { open: boolean; onClose: () => void }) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();

  const cleanup: Record<ForceDeleteDocumentType, string> = {
    purchaseInvoice: t`Payments and memos applied to it are unapplied first: each payment stays posted, as unapplied credit you can apply elsewhere or force delete. Value it added to a capitalized fixed asset is taken back out; depreciation already posted stays.`,
    salesInvoice: t`Payments and memos applied to it are unapplied first: each payment stays posted, as unapplied credit you can apply elsewhere or force delete. Revenue already recognized from it is reversed.`,
    payment: t`Other payments it funds or refunds are unapplied from it first; they stay posted.`,
    receipt: t`Its stock is taken back out, even if it was used since (on-hand can go negative), and what it received is given back to its order.`
  };

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <ModalContent
        // Opened from the header's menu, which gives focus back to its trigger
        // as it closes: an auto-focused Reason was blurred, so validated, and
        // showed its error before anything was typed.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ValidatedForm
          method="post"
          validator={forceDeleteRequestValidator}
          action={path.to.documentForceDelete(documentType, documentId)}
          defaultValues={{ intent: "request", reason: "", confirmation: "" }}
          fetcher={fetcher}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Force delete {readableId}</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" />
            <VStack spacing={4}>
              <Alert variant="destructive">
                <LuTriangleAlert />
                <AlertTitle>
                  <Trans>This is an Admin override</Trans>
                </AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>
                      <Trans>
                        It permanently deletes {readableId}, whatever its
                        status. It cannot be undone.
                      </Trans>
                    </li>
                    <li>
                      <Trans>
                        Nothing is deleted yet. The request goes to the other
                        Admins' approvals, and it is deleted when one of them
                        approves it.
                      </Trans>
                    </li>
                    {isPosted(status) && (
                      <li>
                        <Trans>
                          It is {status}: approving voids it first, which
                          reverses its postings. If the void refuses, its
                          postings are reversed by journal instead.
                        </Trans>
                      </li>
                    )}
                    <li>{cleanup[documentType]}</li>
                    <li>
                      <Trans>
                        Your reason and the decision are kept in the audit log.
                      </Trans>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
              <TextArea
                name="reason"
                label={t`Reason`}
                placeholder={t`What was entered wrongly, and why it cannot be corrected or voided instead`}
              />
              <Input
                name="confirmation"
                label={t`Type ${readableId} to confirm`}
                autoComplete="off"
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit
                variant="destructive"
                isDisabled={fetcher.state !== "idle"}
              >
                <Trans>Request Force Delete</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/**
 * The document's pending force delete: who asked and why, with Approve /
 * Reject for the other Admins and Cancel for the one who asked.
 */
export function DocumentForceDeleteBanner({
  documentType,
  documentId,
  readableId,
  status,
  forceDelete
}: DocumentRef & { forceDelete: DocumentForceDeleteData | undefined }) {
  const { t } = useLingui();
  const user = useUser();
  const fetcher = useFetcher<{}>();
  const approveModal = useDisclosure();
  const request = forceDelete?.forceDeleteRequest;
  if (!request) return null;

  const isAdmin = forceDelete?.isAdmin ?? false;
  const isRequester = request.requestedBy === user.id;
  const canApprove =
    forceDeleteApprovalRefusal({
      status: "Pending",
      requestedBy: request.requestedBy,
      userId: user.id,
      isAdmin
    }) === null;
  // Another Admin's approval is running: nothing to decide until it ends.
  // A claim older than ten minutes is an approval that stopped: approving
  // again is allowed (the service decides).
  const approving = request.status === "Approving" && !request.claimExpired;
  const busy = fetcher.state !== "idle" || approving;
  const action = path.to.documentForceDelete(documentType, documentId);

  const submit = (intent: "reject" | "cancel") => {
    fetcher.submit(
      { intent, requestId: request.id },
      { method: "post", action }
    );
  };

  return (
    <Alert variant="destructive">
      <LuShieldAlert />
      <AlertTitle>
        <Trans>Force delete waiting for another Admin's approval</Trans>
      </AlertTitle>
      <AlertDescription>
        <VStack spacing={2} className="w-full">
          <HStack spacing={2} className="text-sm">
            <span>
              <Trans>Requested by</Trans>
            </span>
            <EmployeeAvatar employeeId={request.requestedBy} />
          </HStack>
          <p className="text-sm whitespace-pre-wrap">{request.reason}</p>
          {approving && (
            <p className="text-sm font-medium">
              <Trans>Being approved now…</Trans>
            </p>
          )}
          {isAdmin && (
            <HStack spacing={2}>
              {canApprove && (
                <Button
                  variant="destructive"
                  isDisabled={busy}
                  onClick={approveModal.onOpen}
                >
                  <Trans>Approve and Delete</Trans>
                </Button>
              )}
              {!isRequester && (
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onClick={() => submit("reject")}
                >
                  <Trans>Reject</Trans>
                </Button>
              )}
              {isRequester && (
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onClick={() => submit("cancel")}
                >
                  <Trans>Cancel Request</Trans>
                </Button>
              )}
            </HStack>
          )}
        </VStack>
        <Confirm
          action={action}
          isOpen={approveModal.isOpen}
          title={t`Approve and delete`}
          text={
            isPosted(status)
              ? t`Approving voids ${readableId}, which reverses its postings, then deletes it. This cannot be undone.`
              : t`Approving deletes ${readableId} now. This cannot be undone.`
          }
          confirmText={t`Approve and Delete`}
          confirmVariant="destructive"
          cancelText={t`Back`}
          onCancel={approveModal.onClose}
          onSubmit={approveModal.onClose}
        >
          <input type="hidden" name="intent" value="approve" />
          <input type="hidden" name="requestId" value={request.id} />
        </Confirm>
      </AlertDescription>
    </Alert>
  );
}
