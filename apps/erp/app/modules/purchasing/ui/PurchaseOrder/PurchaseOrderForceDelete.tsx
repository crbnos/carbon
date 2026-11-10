// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Hidden, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
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
import { useFetcher, useParams } from "react-router";
import { EmployeeAvatar } from "~/components";
import { Input, Submit, TextArea } from "~/components/Form";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  purchaseOrderForceDeleteApprovalRefusal,
  purchaseOrderForceDeleteRequestValidator
} from "../../purchasing.models";
import type { PurchaseOrderForceDeleteRequest } from "../../purchasing.service";

type ForceDeleteRouteData = {
  isAdmin: boolean;
  forceDeleteRequest: PurchaseOrderForceDeleteRequest | null;
  /** The receipts approving reverses (not Voided), by number. */
  forceDeleteReceipts: string[];
};

type PurchaseOrderForceDeleteModalProps = {
  purchaseOrderReadableId: string;
  open: boolean;
  onClose: () => void;
};

/**
 * Asks to force delete the order. The warning says what the override skips
 * and what it never skips; the Admin types the order's number to confirm.
 */
export function PurchaseOrderForceDeleteModal({
  purchaseOrderReadableId,
  open,
  onClose
}: PurchaseOrderForceDeleteModalProps) {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const routeData = useRouteData<ForceDeleteRouteData>(
    path.to.purchaseOrder(orderId)
  );
  const receipts = (routeData?.forceDeleteReceipts ?? []).join(", ");

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
          validator={purchaseOrderForceDeleteRequestValidator}
          action={path.to.purchaseOrderForceDelete(orderId)}
          defaultValues={{ intent: "request", reason: "", confirmation: "" }}
          fetcher={fetcher}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Force delete {purchaseOrderReadableId}</Trans>
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
                        It permanently deletes this purchase order and all of
                        its lines, whatever its status or approval. It cannot be
                        undone.
                      </Trans>
                    </li>
                    <li>
                      <Trans>
                        Nothing is deleted yet. The request goes to the other
                        Admins' approvals, and the order is deleted when one of
                        them approves it.
                      </Trans>
                    </li>
                    {receipts && (
                      <li>
                        <Trans>
                          Approving also reverses its receipts {receipts}: the
                          stock they brought in is removed and their postings
                          are reversed. It is refused if that stock was used
                          since.
                        </Trans>
                      </li>
                    )}
                    <li>
                      <Trans>
                        It never touches the supplier's side of the books. Void
                        the order's shipments and prepayments first, and remove
                        its lines from purchase invoices. The request is refused
                        until you do.
                      </Trans>
                    </li>
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
                placeholder={t`What was entered wrongly, and why the order cannot be corrected or closed instead`}
              />
              <Input
                name="confirmation"
                label={t`Type ${purchaseOrderReadableId} to confirm`}
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
 * The order's pending force delete: who asked and why, with Approve / Reject
 * for the other Admins and Cancel for the one who asked.
 */
export function PurchaseOrderForceDeleteBanner() {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  const { t } = useLingui();
  const user = useUser();
  const fetcher = useFetcher<{}>();
  const approveModal = useDisclosure();
  const routeData = useRouteData<ForceDeleteRouteData>(
    path.to.purchaseOrder(orderId)
  );
  const request = routeData?.forceDeleteRequest;
  if (!request) return null;
  const receipts = (routeData?.forceDeleteReceipts ?? []).join(", ");

  const isAdmin = routeData?.isAdmin ?? false;
  const isRequester = request.requestedBy === user.id;
  const canApprove =
    purchaseOrderForceDeleteApprovalRefusal({
      status: "Pending",
      requestedBy: request.requestedBy,
      userId: user.id,
      isAdmin
    }) === null;
  const busy = fetcher.state !== "idle";

  const submit = (intent: "reject" | "cancel") => {
    fetcher.submit(
      { intent, requestId: request.id },
      { method: "post", action: path.to.purchaseOrderForceDelete(orderId) }
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
          action={path.to.purchaseOrderForceDelete(orderId)}
          isOpen={approveModal.isOpen}
          title={t`Approve and delete`}
          text={
            receipts
              ? t`Approving reverses ${receipts}, then deletes the purchase order and all of its lines. This cannot be undone.`
              : t`Approving deletes the purchase order and all of its lines now. This cannot be undone.`
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
