import { useCarbon } from "@carbon/auth";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  Heading,
  IconButton,
  useDisclosure,
} from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheckCheck,
  LuHandCoins,
  LuPanelLeft,
  LuPanelRight,
  LuShoppingCart,
} from "react-icons/lu";
import { usePanels } from "~/components/Layout/Panels";
import { usePermissions, useRouteData } from "~/hooks";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "~/modules/invoicing";
import { PurchaseInvoicingStatus } from "~/modules/invoicing";
import { path } from "~/utils/path";
import PurchaseInvoicePostModal from "./PurchaseInvoicePostModal";

const PurchaseInvoiceHeader = () => {
  const permissions = usePermissions();
  const { invoiceId } = useParams();
  const postingModal = useDisclosure();

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

  const routeData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    purchaseInvoiceLines: PurchaseInvoiceLine[];
  }>(path.to.purchaseInvoice(invoiceId));

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
          .eq("supplierInteractionId", purchaseInvoice.supplierInteractionId),
      ]);

      if (purchaseOrdersResult.error)
        throw new Error(purchaseOrdersResult.error.message);
      if (receiptsResult.error) throw new Error(receiptsResult.error.message);

      setRelatedDocs({
        purchaseOrders:
          purchaseOrdersResult.data?.map((po) => ({
            id: po.id,
            readableId: po.purchaseOrderId,
          })) ?? [],
        receipts:
          receiptsResult.data?.map((r) => ({
            id: r.id,
            readableId: r.receiptId,
          })) ?? [],
      });
    }

    loadRelatedDocs();
  }, [carbon, purchaseInvoice.supplierInteractionId]);

  const showPostModal = async () => {
    // check if there are any lines that are not associated with a PO
    if (!carbon) throw new Error("carbon not found");
    const { data, error } = await carbon
      .from("purchaseInvoiceLine")
      .select("itemId, itemReadableId, description, quantity, conversionFactor")
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
          description: d.description ?? "",
          quantity: d.quantity * (d.conversionFactor ?? 1),
        })) ?? []
      )
    );
    postingModal.onOpen();
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08),_0px_0px_10px_rgba(0,_0,_0,_0.12),_0px_0px_24px_rgba(0,_0,_0,_0.16),_0px_0px_80px_rgba(0,_0,_0,_0.2)]">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Toggle Explorer"
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.purchaseInvoiceDetails(invoiceId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.purchaseInvoice?.invoiceId}</span>
              </Heading>
            </Link>
            <PurchaseInvoicingStatus
              status={routeData?.purchaseInvoice?.status}
            />
          </HStack>
          <HStack>
            {relatedDocs.purchaseOrders.length === 1 && (
              <Button variant="secondary" leftIcon={<LuShoppingCart />} asChild>
                <Link
                  to={path.to.purchaseOrderDetails(
                    relatedDocs.purchaseOrders[0].id
                  )}
                >
                  Purchase Order
                </Link>
              </Button>
            )}

            {relatedDocs.receipts.length === 1 && (
              <Button variant="secondary" leftIcon={<LuHandCoins />} asChild>
                <Link to={path.to.receipt(relatedDocs.receipts[0].id)}>
                  Receipt
                </Link>
              </Button>
            )}

            {relatedDocs.purchaseOrders.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" leftIcon={<LuShoppingCart />}>
                    Purchase Orders
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
                    Receipts
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
                !permissions.can("update", "invoicing")
              }
            >
              Post
            </Button>

            <IconButton
              aria-label="Toggle Properties"
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
    </>
  );
};

export default PurchaseInvoiceHeader;
