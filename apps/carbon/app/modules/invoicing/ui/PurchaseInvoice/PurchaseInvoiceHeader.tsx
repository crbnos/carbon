import { useCarbon } from "@carbon/auth";
import {
  Button,
  HStack,
  Heading,
  IconButton,
  useDisclosure,
} from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { useState } from "react";
import { LuCheckCheck, LuPanelLeft, LuPanelRight } from "react-icons/lu";
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
    { itemId: string | null; itemReadableId: string | null; quantity: number }[]
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

  const showPostModal = async () => {
    // check if there are any lines that are not associated with a PO
    if (!carbon) throw new Error("carbon not found");
    const { data, error } = await carbon
      .from("purchaseInvoiceLine")
      .select("itemId, itemReadableId, quantity, conversionFactor")
      .eq("invoiceId", invoiceId)
      .in("invoiceLineType", ["Part", "Material", "Tool", "Consumable"])
      .is("purchaseInvoiceLineId", null);

    if (error) throw new Error(error.message);
    if (!data) return;

    // so that we can ask the user if they want to receive those lines
    setLinesNotAssociatedWithPO(
      data?.map((d) => ({
        ...d,
        quantity: d.quantity * (d.conversionFactor ?? 1),
      })) ?? []
    );
    postingModal.onOpen();
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Toggle Explorer"
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.purchaseInvoiceDetails(invoiceId)}>
              <Heading size="h3" className="flex items-center gap-2">
                <span>{routeData?.purchaseInvoice?.invoiceId}</span>
              </Heading>
            </Link>
            <PurchaseInvoicingStatus
              status={routeData?.purchaseInvoice?.status}
            />
          </HStack>
          <HStack>
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
