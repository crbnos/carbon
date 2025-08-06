import {
  Button,
  HStack,
  Heading,
  SplitButton,
  useDisclosure,
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { Link, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuCreditCard,
  LuQrCode,
  LuShoppingCart,
  LuTruck,
} from "react-icons/lu";

import { usePermissions, useRouteData } from "~/hooks";
import type { ItemTracking, Receipt, ReceiptLine } from "~/modules/inventory";
import { ReceiptPostModal, ReceiptStatus } from "~/modules/inventory";
import { path } from "~/utils/path";

const ReceiptHeader = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
    receiptLineTracking: ItemTracking[];
  }>(path.to.receipt(receiptId));

  if (!routeData?.receipt) throw new Error("Failed to load receipt");

  const permissions = usePermissions();
  const postModal = useDisclosure();

  const canPost =
    routeData.receiptLines.length > 0 &&
    routeData.receiptLines.some((line) => (line.receivedQuantity ?? 0) !== 0);

  const isPosted = routeData.receipt.status === "Posted";

  const navigateToTrackingLabels = (zpl?: boolean, labelSize?: string) => {
    if (!window) return;
    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.receiptLabelsZpl(receiptId, { labelSize }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.receiptLabelsPdf(receiptId, { labelSize }),
        "_blank"
      );
    }
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.receiptDetails(receiptId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.receipt?.receiptId}</span>
              </Heading>
            </Link>
            <ReceiptStatus status={routeData?.receipt?.status} />
          </HStack>
          <HStack>
            {routeData.receiptLineTracking.length > 0 && (
              <SplitButton
                leftIcon={<LuQrCode />}
                dropdownItems={labelSizes.map((size) => ({
                  label: size.name,
                  onClick: () => navigateToTrackingLabels(!!size.zpl, size.id),
                }))}
                // TODO: if we knew the preferred label size, we could use that here
                onClick={() => navigateToTrackingLabels(false)}
                variant={isPosted ? "primary" : "secondary"}
              >
                Tracking Labels
              </SplitButton>
            )}
            <SourceDocumentLink
              sourceDocument={routeData.receipt.sourceDocument ?? undefined}
              sourceDocumentId={routeData.receipt.sourceDocumentId ?? undefined}
              sourceDocumentReadableId={
                routeData.receipt.sourceDocumentReadableId ?? undefined
              }
            />
            <Button
              variant={canPost && !isPosted ? "primary" : "secondary"}
              onClick={postModal.onOpen}
              isDisabled={!canPost || isPosted || !permissions.is("employee")}
              leftIcon={<LuCheckCheck />}
            >
              Post
            </Button>
          </HStack>
        </HStack>
      </div>

      {postModal.isOpen && <ReceiptPostModal onClose={postModal.onClose} />}
    </>
  );
};

function SourceDocumentLink({
  sourceDocument,
  sourceDocumentId,
  sourceDocumentReadableId,
}: {
  sourceDocument?: string;
  sourceDocumentId?: string;
  sourceDocumentReadableId?: string;
}) {
  const permissions = usePermissions();
  
  if (!sourceDocument || !sourceDocumentId || !sourceDocumentReadableId)
    return null;
  switch (sourceDocument) {
    case "Purchase Order":
      if (!permissions.can("view", "purchasing")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuShoppingCart />} asChild>
          <Link to={path.to.purchaseOrderDetails(sourceDocumentId!)}>
            Purchase Order
          </Link>
        </Button>
      );
    case "Purchase Invoice":
      if (!permissions.can("view", "invoicing")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuCreditCard />} asChild>
          <Link to={path.to.purchaseInvoice(sourceDocumentId!)}>
            Purchase Invoice
          </Link>
        </Button>
      );
    case "Inbound Transfer":
      if (!permissions.can("view", "inventory")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuTruck />} asChild>
          <Link to={path.to.warehouseTransferDetails(sourceDocumentId!)}>
            Warehouse Transfer
          </Link>
        </Button>
      );
    default:
      return null;
  }
}

export default ReceiptHeader;
