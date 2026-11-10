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
  PURCHASE_ORDER_FORCE_DELETE_APPROVALS_REQUIRED,
  purchaseOrderForceDeleteApprovalRefusal,
  purchaseOrderForceDeleteRequestValidator
} from "../../purchasing.models";
import type { PurchaseOrderForceDeleteRequest } from "../../purchasing.service";

type ForceDeleteRouteData = {
  isAdmin: boolean;
  forceDeleteRequest: PurchaseOrderForceDeleteRequest | null;
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

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <ModalContent>
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
                        Nothing is deleted yet. The deletion runs only after{" "}
                        {PURCHASE_ORDER_FORCE_DELETE_APPROVALS_REQUIRED} other
                        Admins approve it.
                      </Trans>
                    </li>
                    <li>
                      <Trans>
                        It never touches the ledger. Void or delete the order's
                        receipts, shipments and prepayments first, and remove
                        its lines from purchase invoices. The request is refused
                        until you do.
                      </Trans>
                    </li>
                    <li>
                      <Trans>
                        Your reason and every approval are kept in the audit
                        log.
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
 * The order's pending force delete: who asked and why, who has approved, and
 * Approve / Reject for the other Admins (Cancel for the one who asked).
 */
export function PurchaseOrderForceDeleteBanner() {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  const { t } = useLingui();
  const user = useUser();
  const fetcher = useFetcher<{}>();
  const finalApproval = useDisclosure();
  const routeData = useRouteData<ForceDeleteRouteData>(
    path.to.purchaseOrder(orderId)
  );
  const request = routeData?.forceDeleteRequest;
  if (!request) return null;

  const isAdmin = routeData?.isAdmin ?? false;
  const approvedBy = request.approvals.map((a) => a.approvedBy);
  const isRequester = request.requestedBy === user.id;
  const canApprove =
    purchaseOrderForceDeleteApprovalRefusal({
      status: "Pending",
      requestedBy: request.requestedBy,
      approvedBy,
      userId: user.id,
      isAdmin
    }) === null;
  const isFinalApproval =
    approvedBy.length + 1 >= PURCHASE_ORDER_FORCE_DELETE_APPROVALS_REQUIRED;
  const busy = fetcher.state !== "idle";

  const submit = (intent: "approve" | "reject" | "cancel") => {
    fetcher.submit(
      { intent, requestId: request.id },
      { method: "post", action: path.to.purchaseOrderForceDelete(orderId) }
    );
  };

  return (
    <Alert variant="destructive">
      <LuShieldAlert />
      <AlertTitle>
        <Trans>
          Force delete requested ({approvedBy.length} of{" "}
          {PURCHASE_ORDER_FORCE_DELETE_APPROVALS_REQUIRED} Admin approvals)
        </Trans>
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
          {request.approvals.length > 0 && (
            <HStack spacing={2} className="text-sm">
              <span>
                <Trans>Approved by</Trans>
              </span>
              {request.approvals.map((approval) => (
                <EmployeeAvatar
                  key={approval.approvedBy}
                  employeeId={approval.approvedBy}
                />
              ))}
            </HStack>
          )}
          {isAdmin && (
            <HStack spacing={2}>
              {canApprove && (
                <Button
                  variant="destructive"
                  isDisabled={busy}
                  onClick={() =>
                    isFinalApproval ? finalApproval.onOpen() : submit("approve")
                  }
                >
                  {isFinalApproval ? (
                    <Trans>Approve and Delete</Trans>
                  ) : (
                    <Trans>Approve</Trans>
                  )}
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
          isOpen={finalApproval.isOpen}
          title={t`Approve and delete`}
          text={t`Yours is the last approval needed. The purchase order and all of its lines are deleted now, and this cannot be undone.`}
          confirmText={t`Approve and Delete`}
          confirmVariant="destructive"
          cancelText={t`Back`}
          onCancel={finalApproval.onClose}
          onSubmit={finalApproval.onClose}
        >
          <input type="hidden" name="intent" value="approve" />
          <input type="hidden" name="requestId" value={request.id} />
        </Confirm>
      </AlertDescription>
    </Alert>
  );
}
