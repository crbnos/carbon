import { HStack, Heading, IconButton } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { LuPanelLeft, LuPanelRight } from "react-icons/lu";
import { usePanels } from "~/components/Layout";

import { useRouteData } from "~/hooks";

import { path } from "~/utils/path";

import type {
  SupplierInteraction,
  SupplierQuote,
  SupplierQuoteLine,
  SupplierQuoteLinePrice,
} from "../../types";
import SupplierQuoteStatus from "./SupplierQuoteStatus";

const SupplierQuoteHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    quote: SupplierQuote;
    lines: SupplierQuoteLine[];
    interaction: SupplierInteraction;
    prices: SupplierQuoteLinePrice[];
  }>(path.to.supplierQuote(id));

  // const convertToOrderModal = useDisclosure();

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
            <Link to={path.to.supplierQuoteDetails(id)}>
              <Heading size="h4">
                <span>{routeData?.quote?.supplierQuoteId}</span>
              </Heading>
            </Link>
            <SupplierQuoteStatus status={routeData?.quote?.status} />
          </HStack>
          <HStack>
            {/* <Button
              isDisabled={
                routeData?.quote?.status !== "Active" ||
                !permissions.can("update", "purchasing")
              }
              leftIcon={<LuShoppingCart />}
              onClick={convertToOrderModal.onOpen}
            >
              Order
            </Button> */}

            <IconButton
              aria-label="Toggle Properties"
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>

      {/* <SupplierQuoteToOrderModal
        isOpen={convertToOrderModal.isOpen}
        onClose={convertToOrderModal.onClose}
        quote={routeData?.quote!}
        lines={routeData?.lines ?? []}
        pricing={routeData?.prices ?? []}
      /> */}
    </>
  );
};

export default SupplierQuoteHeader;
