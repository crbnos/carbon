import {
  Button,
  HStack,
  Heading,
  SplitButton,
  useDisclosure,
} from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { LuCheckCheck, LuBarcode, LuQrCode } from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemTracking, Shipment, ShipmentLine } from "~/modules/inventory";

import { path } from "~/utils/path";
import ShipmentPostModal from "./ShipmentPostModal";
import { RiProgress8Line } from "react-icons/ri";
import type { TrackedEntityAttributes } from "@carbon/utils";
import ShipmentStatus from "./ShipmentStatus";
import { labelSizes } from "@carbon/utils";

const ShipmentHeader = () => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLines: ShipmentLine[];
    shipmentLineTracking: ItemTracking[];
  }>(path.to.shipment(shipmentId));

  if (!routeData?.shipment) throw new Error("Failed to load shipment");

  const permissions = usePermissions();
  const postModal = useDisclosure();

  const canPost =
    routeData.shipmentLines.length > 0 &&
    routeData.shipmentLines.some((line) => (line.shippedQuantity ?? 0) !== 0);

  const isPosted = routeData.shipment.status === "Posted";
  const hasTrackingLabels = routeData.shipmentLineTracking.some(
    (line) => "Split Entity ID" in (line.attributes as TrackedEntityAttributes)
  );

  const navigateToTrackingLabels = (zpl?: boolean, labelSize?: string) => {
    if (!window) return;
    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.shipmentLabelsZpl(shipmentId, {
            labelSize,
          }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.shipmentLabelsPdf(shipmentId, { labelSize }),
        "_blank"
      );
    }
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1)]">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.shipmentDetails(shipmentId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.shipment?.shipmentId}</span>
              </Heading>
            </Link>
            <ShipmentStatus status={routeData?.shipment?.status} />
          </HStack>
          <HStack>
            {hasTrackingLabels && (
              <SplitButton
                leftIcon={<LuQrCode />}
                dropdownItems={labelSizes.map((size) => ({
                  label: size.name,
                  onClick: () => navigateToTrackingLabels(!!size.zpl, size.id),
                }))}
                // TODO: if we knew the preferred label size, we could use that here
                onClick={() => navigateToTrackingLabels(false)}
                variant="primary"
              >
                Tracking Labels
              </SplitButton>
            )}

            <Button variant="secondary" leftIcon={<LuBarcode />} asChild>
              <a
                target="_blank"
                href={path.to.file.shipment(shipmentId)}
                rel="noreferrer"
              >
                Packing Slip
              </a>
            </Button>

            <SourceDocumentLink
              sourceDocument={routeData.shipment.sourceDocument ?? undefined}
              sourceDocumentId={
                routeData.shipment.sourceDocumentId ?? undefined
              }
              sourceDocumentReadableId={
                routeData.shipment.sourceDocumentReadableId ?? undefined
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

      {postModal.isOpen && <ShipmentPostModal onClose={postModal.onClose} />}
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
    case "Sales Order":
      if (!permissions.can("view", "sales")) return null;
      return (
        <Button variant="secondary" leftIcon={<RiProgress8Line />} asChild>
          <Link to={path.to.salesOrderDetails(sourceDocumentId!)}>
            Sales Order
          </Link>
        </Button>
      );
    // case "Sales Invoice":
    //   return (
    //     <Button variant="secondary" leftIcon={<LuCreditCard />} asChild>
    //       <Link to={path.to.salesInvoiceDetails(sourceDocumentId!)}>
    //         Sales Invoice
    //       </Link>
    //     </Button>
    //   );
    default:
      return null;
  }
}

export default ShipmentHeader;
