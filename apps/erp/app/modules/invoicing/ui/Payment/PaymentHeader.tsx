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
import PaymentStatus from "./PaymentStatus";

type Payment = Database["public"]["Tables"]["payment"]["Row"];

const PaymentHeader = () => {
  const { t } = useLingui();
  const { paymentId } = useParams();
  if (!paymentId) throw new Error("paymentId not found");

  const routeData = useRouteData<{ payment: Payment }>(
    path.to.payment(paymentId)
  );

  const permissions = usePermissions();
  const post = useFetcher();
  const voidModal = useDisclosure();
  const deleteModal = useDisclosure();

  const payment = routeData?.payment;
  if (!payment) throw new Error("Could not find payment in routeData");

  const status = payment.status;
  const isDraft = status === "Draft";
  const isPosted = status === "Posted";
  const canMutate = permissions.can("update", "invoicing");
  const canDelete = permissions.can("delete", "invoicing");

  return (
    <>
      <DocumentPageHeader
        title={payment.paymentId}
        status={
          <>
            <Enumerable value={payment.paymentType} />
            <PaymentStatus status={status} />
          </>
        }
        meta={[
          <Trans key="created">
            Created <DateTime value={payment.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={payment.createdBy} />
          </Trans>,
          payment.postingDate ? (
            payment.postedBy ? (
              <Trans key="posted">
                Posted <DateTime value={payment.postingDate} variant="date" />{" "}
                by <EmployeeAvatar employeeId={payment.postedBy} />
              </Trans>
            ) : (
              <Trans key="posted">
                Posted <DateTime value={payment.postingDate} variant="date" />
              </Trans>
            )
          ) : null,
          payment.voidedAt ? (
            payment.voidedBy ? (
              <Trans key="voided">
                Voided <DateTime value={payment.voidedAt} variant="date" /> by{" "}
                <EmployeeAvatar employeeId={payment.voidedBy} />
              </Trans>
            ) : (
              <Trans key="voided">
                Voided <DateTime value={payment.voidedAt} variant="date" />
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
              <Trans>Delete Payment</Trans>
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
                  action: path.to.paymentPost(payment.id)
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
          action={path.to.paymentVoid(payment.id)}
          name={payment.paymentId}
          title={t`Void ${payment.paymentId}`}
          text={t`Are you sure you want to void this payment? This will reverse its accounting entries and applications. This cannot be undone.`}
          deleteText={t`Void`}
          onCancel={voidModal.onClose}
          onSubmit={voidModal.onClose}
        />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.paymentDelete(payment.id)}
          isOpen={deleteModal.isOpen}
          name={payment.paymentId}
          text={t`Are you sure you want to delete ${payment.paymentId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
    </>
  );
};

export default PaymentHeader;
