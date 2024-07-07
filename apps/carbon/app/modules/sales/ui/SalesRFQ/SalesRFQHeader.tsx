import { Badge, HStack, Heading, VStack } from "@carbon/react";

import { useParams } from "@remix-run/react";
import { RiProgress2Line } from "react-icons/ri";
import { useRouteData } from "~/hooks";
import type { SalesRFQ } from "~/modules/sales";
import { path } from "~/utils/path";

const SalesRFQHeader = () => {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const routeData = useRouteData<{ rfqSummary: SalesRFQ }>(
    path.to.salesRfq(rfqId)
  );

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Heading size="h2">{routeData?.rfqSummary?.rfqId}</Heading>
          <Badge variant="secondary">
            <RiProgress2Line />
          </Badge>
        </HStack>
      </VStack>
    </div>
  );
};

export default SalesRFQHeader;
