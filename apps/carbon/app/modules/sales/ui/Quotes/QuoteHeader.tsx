import { Badge, HStack, Heading, VStack } from "@carbon/react";

import { useParams } from "@remix-run/react";
import { RiProgress4Line } from "react-icons/ri";

import { useRouteData } from "~/hooks";
import type { Quotation } from "~/modules/sales";
import { path } from "~/utils/path";

const QuoteHeader = () => {
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const routeData = useRouteData<{ quote: Quotation }>(path.to.quote(quoteId));

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Heading size="h2">{routeData?.quote?.quoteId}</Heading>
          <Badge variant="secondary">
            <Badge variant="secondary">
              <RiProgress4Line />
            </Badge>
          </Badge>
        </HStack>
      </VStack>
    </div>
  );
};

export default QuoteHeader;
