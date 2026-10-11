// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck, LuCreditCard, LuTicketX, LuTrash } from "react-icons/lu";
import { Link, useNavigation, useParams } from "react-router";
import { DateTime, EmployeeAvatar, PrintButton } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemTracking, Receipt, ReceiptLine } from "~/modules/inventory";
import { path } from "~/utils/path";
import ReceiptPostModal from "./ReceiptPostModal";
import ReceiptStatus from "./ReceiptStatus";
import ReceiptVoidModal from "./ReceiptVoidModal";

const ReceiptHeader = () => {
  const { t } = useLingui();
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
    receiptLineTracking: ItemTracking[];
    fixedAssetLines: { id: string; received: boolean }[];
    rentalLines: { id: string; received: boolean }[];
  }>(path.to.receipt(receiptId));

  const permissions = usePermissions();
  const navigation = useNavigation();
  const postModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteDisclosure = useDisclosure();

  const receipt = routeData?.receipt;
  if (!receipt) throw new Error("Could not find receipt in routeData");

  const status = receipt.status;
  const isPosted = status === "Posted";
  const isVoided = status === "Voided";
  const isInvoiced = receipt.invoiced === true;
  // post-receipt voids only these two; any other source would always error.
  const isVoidable =
    receipt.sourceDocument === "Purchase Order" ||
    receipt.sourceDocument === "Sales Return Order";

  const receiptLines = routeData?.receiptLines ?? [];
  const hasReceivableFaLines = (routeData?.fixedAssetLines ?? []).some(
    (line) => line.received
  );
  const hasReceivableRentalLines = (routeData?.rentalLines ?? []).some(
    (line) => line.received
  );
  const canPost =
    receiptLines.some((line) => (line.receivedQuantity ?? 0) !== 0) ||
    hasReceivableFaLines ||
    hasReceivableRentalLines;

  const hasTrackingLabels = (routeData?.receiptLineTracking ?? []).length > 0;

  // Only a purchase-order receipt is billed from here; once it is, the
  // invoice is listed under Documents instead.
  const showInvoice =
    receipt.sourceDocument === "Purchase Order" &&
    Boolean(receipt.sourceDocumentId) &&
    !isInvoiced &&
    !isVoided &&
    permissions.can("view", "invoicing");
  const canInvoice = isPosted && permissions.can("create", "invoicing");
  const isInvoicing =
    navigation.state !== "idle" &&
    navigation.location?.pathname === path.to.newPurchaseInvoice;

  return (
    <>
      <DocumentPageHeader
        title={receipt.receiptId}
        status={<ReceiptStatus status={status} />}
        meta={[
          <Trans key="created">
            Created <DateTime value={receipt.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={receipt.createdBy} />
          </Trans>,
          receipt.postingDate ? (
            receipt.postedBy ? (
              <Trans key="posted">
                Posted <DateTime value={receipt.postingDate} variant="date" />{" "}
                by <EmployeeAvatar employeeId={receipt.postedBy} />
              </Trans>
            ) : (
              <Trans key="posted">
                Posted <DateTime value={receipt.postingDate} variant="date" />
              </Trans>
            )
          ) : null
        ]}
        menuItems={
          <>
            {isPosted && isVoidable && (
              <>
                <DropdownMenuItem
                  disabled={
                    isInvoiced || !permissions.can("update", "inventory")
                  }
                  destructive
                  onClick={voidModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTicketX />} />
                  <Trans>Void</Trans>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              disabled={
                !permissions.can("delete", "inventory") ||
                !permissions.is("employee")
              }
              destructive
              onClick={deleteDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete Receipt</Trans>
            </DropdownMenuItem>
          </>
        }
        actions={
          <>
            {hasTrackingLabels && (
              <PrintButton
                sourceDocument="Receipt"
                sourceDocumentId={receiptId}
                locationId={receipt.locationId ?? undefined}
                context="receiving"
                fileRoutes={{
                  pdf: path.to.file.receiptLabelsPdf,
                  zpl: path.to.file.receiptLabelsZpl
                }}
              />
            )}
            {showInvoice &&
              (canInvoice ? (
                <Button
                  variant="primary"
                  isDisabled={isInvoicing}
                  isLoading={isInvoicing}
                  leftIcon={<LuCreditCard />}
                  asChild
                >
                  <Link
                    to={`${path.to.newPurchaseInvoice}?sourceDocument=Purchase Order&sourceDocumentId=${receipt.sourceDocumentId}`}
                  >
                    <Trans>Invoice</Trans>
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  isDisabled
                  leftIcon={<LuCreditCard />}
                >
                  <Trans>Invoice</Trans>
                </Button>
              ))}
            {!isPosted && !isVoided && (
              <Button
                variant="primary"
                onClick={postModal.onOpen}
                isDisabled={!canPost || !permissions.is("employee")}
                leftIcon={<LuCheckCheck />}
              >
                <Trans>Post</Trans>
              </Button>
            )}
          </>
        }
      />

      {postModal.isOpen && <ReceiptPostModal onClose={postModal.onClose} />}
      {voidModal.isOpen && <ReceiptVoidModal onClose={voidModal.onClose} />}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteReceipt(receiptId)}
          isOpen={deleteDisclosure.isOpen}
          name={receipt.receiptId ?? "receipt"}
          text={t`Are you sure you want to delete ${receipt.receiptId}? This cannot be undone.`}
          onCancel={deleteDisclosure.onClose}
          onSubmit={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default ReceiptHeader;
