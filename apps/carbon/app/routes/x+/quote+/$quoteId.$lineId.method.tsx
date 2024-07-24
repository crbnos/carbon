import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";

import { QuoteBillOfMaterial, QuoteBillOfProcess } from "~/modules/sales";

export default function QuoteMakeMethodRoute() {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteMakeMethodId = "";

  return (
    <VStack spacing={2} className="p-2">
      <QuoteBillOfProcess
        key={`bop:${quoteId}:${lineId}`}
        quoteMakeMethodId={quoteMakeMethodId}
        operations={[]}
      />
      <QuoteBillOfMaterial
        key={`bom:${quoteId}:${lineId}`}
        quoteMakeMethodId={quoteMakeMethodId}
        materials={[]}
        operations={[]}
      />
    </VStack>
  );
}
