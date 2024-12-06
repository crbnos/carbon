import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";

import type { MakeMethod, Material, MethodOperation } from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  MakeMethodTools,
} from "~/modules/items/ui/Item";

import { path } from "~/utils/path";

export default function MakeMethodRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const manufacturingRouteData = useRouteData<{
    makeMethod: MakeMethod;
    methodMaterials: Material[];
    methodOperations: MethodOperation[];
  }>(path.to.toolManufacturing(itemId));

  const makeMethodId = manufacturingRouteData?.makeMethod?.id;
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  return (
    <VStack spacing={2} className="p-2">
      <MakeMethodTools itemId={itemId} type="Tool" />
      <BillOfProcess
        key={`bop:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations ?? []}
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        materials={manufacturingRouteData?.methodMaterials ?? []}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations}
      />
    </VStack>
  );
}
