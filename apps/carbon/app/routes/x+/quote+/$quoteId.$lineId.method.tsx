import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { Tree } from "~/components/TreeView/TreeView";
import { useRouteData } from "~/hooks";

import type { QuoteMethod } from "~/modules/sales";
import { QuoteBillOfMaterial, QuoteBillOfProcess } from "~/modules/sales";
import { path } from "~/utils/path";

export default function QuoteMakeMethodRoute() {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const quoteData = useRouteData<{ methods: Tree<QuoteMethod>[] }>(
    path.to.quote(quoteId)
  );

  const methodTree = quoteData?.methods?.find(
    (m) => m.data.quoteLineId === lineId
  );

  const quoteMakeMethodId = methodTree?.data.quoteMaterialMakeMethodId;
  if (!quoteMakeMethodId) throw new Error("Could not find quoteMakeMethodId");

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
