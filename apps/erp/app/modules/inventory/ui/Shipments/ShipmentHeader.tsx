import {
  Button,
  DropdownMenu,
  HStack,
  Heading,
  IconButton,
  useDisclosure,
} from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuBarcode,
  LuPanelLeft,
  LuPanelRight,
} from "react-icons/lu";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import type { Shipment, ShipmentLine } from "~/modules/inventory";

import { path } from "~/utils/path";
import ShipmentStatus from "./ShipmentStatus";
import ShipmentPostModal from "./ShipmentPostModal";
import { RiProgress8Line } from "react-icons/ri";

const ShipmentHeader = () => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLines: ShipmentLine[];
  }>(path.to.shipment(shipmentId));

  if (!routeData?.shipment) throw new Error("Failed to load shipment");

  const permissions = usePermissions();
  const postModal = useDisclosure();

  const canPost =
    routeData.shipmentLines.length > 0 &&
    routeData.shipmentLines.some((line) => line.shippedQuantity > 0);

  const isPosted = routeData.shipment.status === "Posted";

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1)]">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Toggle Explorer"
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.shipmentDetails(shipmentId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.shipment?.shipmentId}</span>
              </Heading>
            </Link>
            <ShipmentStatus status={routeData?.shipment?.status} />
          </HStack>
          <HStack>
            <DropdownMenu>
              <Button variant="secondary" leftIcon={<LuBarcode />} asChild>
                <a
                  target="_blank"
                  href={path.to.file.shipment(shipmentId)}
                  rel="noreferrer"
                >
                  Packing Slip
                </a>
              </Button>
            </DropdownMenu>
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

            <IconButton
              aria-label="Toggle Properties"
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
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
