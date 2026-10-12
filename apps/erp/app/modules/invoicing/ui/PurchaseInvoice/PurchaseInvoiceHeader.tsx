// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MENU_ITEM_SHORTCUTS,
  Status,
  useDisclosure
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheckCheck,
  LuHandCoins,
  LuShoppingCart,
  LuTicketX,
  LuTrash
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { usePanels } from "~/components/Layout/Panels";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  usePermissions,
  useRouteData,
  useSupplierApprovalRequired,
  useUser
} from "~/hooks";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "~/modules/invoicing";
import { isInvoicePayable, PurchaseInvoicingStatus } from "~/modules/invoicing";
import { getPayInvoiceHref } from "~/modules/invoicing/ui/Payment/PaymentForm";
import { useItems } from "~/stores";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import { isPurchaseInvoiceLocked } from "../../invoicing.models";
import PurchaseInvoicePostModal from "./PurchaseInvoicePostModal";
import PurchaseInvoiceVoidModal from "./PurchaseInvoiceVoidModal";

const PurchaseInvoiceHeader = () => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const supplierApprovalRequired = useSupplierApprovalRequired();
  const { invoiceId } = useParams();
  const { company } = useUser();
  const postingModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "purchaseInvoice",
    // @ts-expect-error TS2322 - TODO: fix type
    entityId: invoiceId,
    companyId: company.id,
    variant: "dropdown"
  });

  const { carbon } = useCarbon();
  const [linesNotAssociatedWithPO, setLinesNotAssociatedWithPO] = useState<
    {
      itemId: string | null;
      itemReadableId: string | null;
      description: string;
      quantity: number;
    }[]
  >([]);

  if (!invoiceId) throw new Error("invoiceId not found");

  const [items] = useItems();
  const [suppliers] = useSuppliers();
  const routeData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    purchaseInvoiceLines: PurchaseInvoiceLine[];
    orgHasCredits: boolean;
    rampMapping: {
      id: string;
      externalId: string | null;
      metadata: { deepLink?: string } | null;
    } | null;
  }>(path.to.purchaseInvoice(invoiceId));
  const rampMapping = routeData?.rampMapping ?? null;
  const rampDeepLink = rampMapping?.metadata?.deepLink ?? null;

  const isSupplierApproved = useMemo(
    () =>
      !supplierApprovalRequired ||
      suppliers.find((s) => s.id === routeData?.purchaseInvoice?.supplierId)
        ?.supplierStatus === "Active",
    [
      supplierApprovalRequired,
      routeData?.purchaseInvoice?.supplierId,
      suppliers
    ]
  );

  if (!routeData?.purchaseInvoice) throw new Error("purchaseInvoice not found");
  const { purchaseInvoice } = routeData;
  const { toggleExplorer, toggleProperties } = usePanels();
  const isPosted = purchaseInvoice.postingDate !== null;
  const isVoided = purchaseInvoice.status === "Voided";
  const hasPayment =
    purchaseInvoice.status === "Paid" ||
    purchaseInvoice.status === "Partially Paid";
  const canVoid = isPosted && !isVoided && !hasPayment;

  const [relatedDocs, setRelatedDocs] = useState<{
    purchaseOrders: { id: string; readableId: string }[];
    receipts: { id: string; readableId: string }[];
  }>({ purchaseOrders: [], receipts: [] });

  // Load related documents on mount
  useEffect(() => {
    async function loadRelatedDocs() {
      if (!carbon || !purchaseInvoice.supplierInteractionId) return;

      const [purchaseOrdersResult, receiptsResult] = await Promise.all([
        carbon
          .from("purchaseOrder")
          .select("id, purchaseOrderId")
          .eq("supplierInteractionId", purchaseInvoice.supplierInteractionId),
        carbon
          .from("receipt")
          .select("id, receiptId")
          .eq("supplierInteractionId", purchaseInvoice.supplierInteractionId)
      ]);

      if (purchaseOrdersResult.error)
        throw new Error(purchaseOrdersResult.error.message);
      if (receiptsResult.error) throw new Error(receiptsResult.error.message);

      setRelatedDocs({
        purchaseOrders:
          purchaseOrdersResult.data?.map((po) => ({
            id: po.id,
            readableId: po.purchaseOrderId
          })) ?? [],
        receipts:
          receiptsResult.data?.map((r) => ({
            id: r.id,
            readableId: r.receiptId
          })) ?? []
      });
    }

    loadRelatedDocs();
  }, [carbon, purchaseInvoice.supplierInteractionId]);

  const showPostModal = async () => {
    // check if there are any lines that are not associated with a PO
    if (!carbon) throw new Error("carbon not found");
    const { data, error } = await carbon
      .from("purchaseInvoiceLine")
      .select("itemId, description, quantity, conversionFactor")
      .eq("invoiceId", invoiceId)
      // Services are never received, so they never generate a receipt — mirror
      // the post-purchase-invoice server function and exclude them here.
      .in("invoiceLineType", [
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Fixture"
      ])
      .is("purchaseOrderLineId", null);

    if (error) throw new Error(error.message);
    if (!data) return;

    // so that we can ask the user if they want to receive those lines
    flushSync(() =>
      setLinesNotAssociatedWithPO(
        data?.map((d) => ({
          ...d,
          itemReadableId: getItemReadableId(items, d.itemId) ?? null,
          description: d.description ?? "",
          quantity: d.quantity * (d.conversionFactor ?? 1)
        })) ?? []
      )
    );
    postingModal.onOpen();
  };

  // Status is derived from invoiceSettlement rows, except base-status 'Paid',
  // which is the legacy/Xero "settled" signal. Payments settle an invoice;
  // there is no manual Mark as Paid.
  const canMakePayment =
    isInvoicePayable(purchaseInvoice.status, purchaseInvoice.balance) &&
    permissions.can("create", "invoicing");
  const makePaymentHref = getPayInvoiceHref({
    side: "ap",
    partyId: purchaseInvoice.supplierId,
    invoiceId,
    balance: purchaseInvoice.balance
  });
  const isDraft = routeData?.purchaseInvoice?.status === "Draft";
  const menuItems = (
    <>
      {auditLogTrigger}
      {isPosted && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canVoid || !permissions.can("update", "invoicing")}
            destructive
            onClick={voidModal.onOpen}
          >
            <DropdownMenuIcon icon={<LuTicketX />} />
            <Trans>Void</Trans>
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        disabled={
          isPurchaseInvoiceLocked(routeData?.purchaseInvoice?.status) ||
          !permissions.can("delete", "invoicing") ||
          !permissions.is("employee")
        }
        destructive
        onClick={deleteModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Purchase Invoice</Trans>
      </DropdownMenuItem>
    </>
  );
  const statusBadges = (
    <>
      <PurchaseInvoicingStatus
        // @ts-expect-error TS2322 - TODO: fix type
        status={routeData?.purchaseInvoice?.status}
      />
      {supplierApprovalRequired && !isSupplierApproved && (
        <Status color="red">
          <Trans>Unapproved Supplier</Trans>
        </Status>
      )}
      {rampMapping &&
        (rampDeepLink ? (
          <a href={rampDeepLink} target="_blank" rel="noreferrer">
            <Status color="blue">
              <Trans>Ramp</Trans>
            </Status>
          </a>
        ) : (
          <Status color="blue">
            <Trans>Ramp</Trans>
          </Status>
        ))}
    </>
  );
  return (
    <>
      <RecordHeader
        title={routeData?.purchaseInvoice?.invoiceId}
        titleTo={path.to.purchaseInvoiceDetails(invoiceId)}
        copyValue={routeData?.purchaseInvoice?.invoiceId ?? ""}
        menu={menuItems}
        status={statusBadges}
        onToggleExplorer={toggleExplorer}
        onToggleProperties={toggleProperties}
        actions={
          <>
            {relatedDocs.purchaseOrders.length === 1 && (
              <RecordAction slot="overflow">
                <Button
                  variant="secondary"
                  leftIcon={<LuShoppingCart />}
                  asChild
                >
                  <Link
                    to={path.to.purchaseOrderDetails(
                      relatedDocs.purchaseOrders[0].id
                    )}
                  >
                    <Trans>Purchase Order</Trans>
                  </Link>
                </Button>
              </RecordAction>
            )}

            {relatedDocs.receipts.length === 1 && (
              <RecordAction slot="overflow">
                <Button variant="secondary" leftIcon={<LuHandCoins />} asChild>
                  <Link to={path.to.receipt(relatedDocs.receipts[0].id)}>
                    <Trans>Receipt</Trans>
                  </Link>
                </Button>
              </RecordAction>
            )}

            {relatedDocs.purchaseOrders.length > 1 && (
              <RecordAction slot="overflow">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" leftIcon={<LuShoppingCart />}>
                      <Trans>Purchase Orders</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {relatedDocs.purchaseOrders.map((po) => (
                      <DropdownMenuItem key={po.id} asChild>
                        <Link to={path.to.purchaseOrderDetails(po.id)}>
                          {po.readableId}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </RecordAction>
            )}

            {relatedDocs.receipts.length > 1 && (
              <RecordAction slot="overflow">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" leftIcon={<LuHandCoins />}>
                      <Trans>Receipts</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {relatedDocs.receipts.map((receipt) => (
                      <DropdownMenuItem key={receipt.id} asChild>
                        <Link to={path.to.receipt(receipt.id)}>
                          {receipt.readableId}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </RecordAction>
            )}
            <RecordAction slot={isDraft ? "primary" : "secondary"}>
              <Button
                leftIcon={<LuCheckCheck />}
                variant={
                  routeData?.purchaseInvoice?.status === "Draft"
                    ? "primary"
                    : "secondary"
                }
                onClick={showPostModal}
                isDisabled={
                  isPosted ||
                  routeData?.purchaseInvoiceLines?.length === 0 ||
                  !permissions.can("update", "invoicing") ||
                  !isSupplierApproved
                }
              >
                <Trans>Post</Trans>
              </Button>
            </RecordAction>

            {canMakePayment && (
              <RecordAction slot={isDraft ? "secondary" : "primary"}>
                <Button variant="primary" leftIcon={<LuHandCoins />} asChild>
                  <Link to={makePaymentHref}>
                    <Trans>Payment</Trans>
                  </Link>
                </Button>
              </RecordAction>
            )}
          </>
        }
      />

      {postingModal.isOpen && (
        <PurchaseInvoicePostModal
          invoiceId={invoiceId}
          isOpen={postingModal.isOpen}
          onClose={postingModal.onClose}
          linesToReceive={linesNotAssociatedWithPO}
        />
      )}
      {voidModal.isOpen && (
        <PurchaseInvoiceVoidModal onClose={voidModal.onClose} />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deletePurchaseInvoice(invoiceId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.purchaseInvoice?.invoiceId ?? "purchase invoice"}
          text={t`Are you sure you want to delete ${routeData?.purchaseInvoice?.invoiceId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default PurchaseInvoiceHeader;
