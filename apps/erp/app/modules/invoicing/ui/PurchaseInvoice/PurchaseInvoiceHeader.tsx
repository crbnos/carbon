import { useCarbon } from "@carbon/auth";
import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Status,
  useDisclosure
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheckCheck,
  LuChevronDown,
  LuEllipsisVertical,
  LuHandCoins,
  LuPanelLeft,
  LuPanelRight,
  LuShoppingCart,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { usePanels } from "~/components/Layout/Panels";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useSettings, useUser } from "~/hooks";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "~/modules/invoicing";
import { PurchaseInvoicingStatus } from "~/modules/invoicing";
import type { action as statusAction } from "~/routes/x+/purchase-invoice+/$invoiceId.status";
import { useItems } from "~/stores";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import { isPurchaseInvoiceLocked } from "../../invoicing.models";
import PurchaseInvoicePostModal from "./PurchaseInvoicePostModal";

const PurchaseInvoiceHeader = () => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const settings = useSettings();
  const { invoiceId } = useParams();
  const { company } = useUser();
  const postingModal = useDisclosure();
  const deleteModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "purchaseInvoice",
    // @ts-expect-error TS2322 - TODO: fix type
    entityId: invoiceId,
    companyId: company.id,
    variant: "dropdown"
  });

  const statusFetcher = useFetcher<typeof statusAction>();

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
  }>(path.to.purchaseInvoice(invoiceId));

  const isSupplierApproved = useMemo(
    () =>
      !settings?.supplierApproval ||
      suppliers.find((s) => s.id === routeData?.purchaseInvoice?.supplierId)
        ?.supplierStatus === "Active",
    [
      settings?.supplierApproval,
      routeData?.purchaseInvoice?.supplierId,
      suppliers
    ]
  );

  if (!routeData?.purchaseInvoice) throw new Error("purchaseInvoice not found");
  const { purchaseInvoice } = routeData;
  const { toggleExplorer, toggleProperties } = usePanels();
  const isPosted = purchaseInvoice.postingDate !== null;

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
      .in("invoiceLineType", ["Part", "Material", "Tool", "Consumable"])
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

  const handleStatusChange = (status: string) => {
    statusFetcher.submit(
      { status },
      { method: "post", action: path.to.purchaseInvoiceStatus(invoiceId) }
    );
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b h-[50px] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label={t`Toggle Explorer`}
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.purchaseInvoiceDetails(invoiceId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.purchaseInvoice?.invoiceId}</span>
              </Heading>
            </Link>
            <Copy text={routeData?.purchaseInvoice?.invoiceId ?? ""} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {auditLogTrigger}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    isPurchaseInvoiceLocked(
                      routeData?.purchaseInvoice?.status
                    ) ||
                    !permissions.can("delete", "invoicing") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Purchase Invoice</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <PurchaseInvoicingStatus
              // @ts-expect-error TS2322 - TODO: fix type
              status={routeData?.purchaseInvoice?.status}
            />
            {settings?.supplierApproval && !isSupplierApproved && (
              <Status color="red">
                <Trans>Unapproved Supplier</Trans>
              </Status>
            )}
          </HStack>
          <HStack>
            {relatedDocs.purchaseOrders.length === 1 && (
              <Button variant="secondary" leftIcon={<LuShoppingCart />} asChild>
                <Link
                  to={path.to.purchaseOrderDetails(
                    relatedDocs.purchaseOrders[0].id
                  )}
                >
                  <Trans>Purchase Order</Trans>
                </Link>
              </Button>
            )}

            {relatedDocs.receipts.length === 1 && (
              <Button variant="secondary" leftIcon={<LuHandCoins />} asChild>
                <Link to={path.to.receipt(relatedDocs.receipts[0].id)}>
                  <Trans>Receipt</Trans>
                </Link>
              </Button>
            )}

            {relatedDocs.purchaseOrders.length > 1 && (
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
            )}

            {relatedDocs.receipts.length > 1 && (
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
            )}
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  isDisabled={
                    purchaseInvoice.status === "Draft" ||
                    purchaseInvoice.status === "Pending" ||
                    !permissions.can("update", "invoicing")
                  }
                  leftIcon={<LuHandCoins />}
                  rightIcon={<LuChevronDown />}
                >
                  <Trans>Payment</Trans>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={purchaseInvoice.status ?? "Draft"}
                  onValueChange={handleStatusChange}
                >
                  {(["Paid", "Partially Paid", "Voided"] as const).map(
                    (status) => (
                      <DropdownMenuRadioItem
                        disabled={
                          !permissions.can("update", "invoicing") ||
                          ![
                            "Submitted",
                            "Paid",
                            "Partially Paid",
                            "Voided"
                          ].includes(purchaseInvoice.status ?? "")
                        }
                        key={status}
                        value={status}
                      >
                        <PurchaseInvoicingStatus status={status} />
                      </DropdownMenuRadioItem>
                    )
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <IconButton
              aria-label={t`Toggle Properties`}
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>

      {postingModal.isOpen && (
        <PurchaseInvoicePostModal
          invoiceId={invoiceId}
          isOpen={postingModal.isOpen}
          onClose={postingModal.onClose}
          linesToReceive={linesNotAssociatedWithPO}
        />
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
