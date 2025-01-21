import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { getTagsList } from "~/modules/shared";

import type {
  MakeMethod,
  Material,
  MethodOperation,
  ToolSummary,
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  MakeMethodTools,
} from "~/modules/items/ui/Item";

import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const tags = await getTagsList(client, companyId, "operation");

  return json({ tags: tags.data ?? [] });
}

export default function MakeMethodRoute() {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const { tags } = useLoaderData<typeof loader>();

  const manufacturingRouteData = useRouteData<{
    makeMethod: MakeMethod;
    methodMaterials: Material[];
    methodOperations: MethodOperation[];
  }>(path.to.toolManufacturing(itemId));

  const itemRouteData = useRouteData<{
    toolSummary: ToolSummary;
  }>(path.to.tool(itemId));

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
        tags={tags}
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        materials={manufacturingRouteData?.methodMaterials ?? []}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations}
      />
      <CadModel
        isReadOnly={!permissions.can("update", "tools")}
        metadata={{ itemId }}
        modelPath={itemRouteData?.toolSummary?.modelPath ?? null}
        title="CAD Model"
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />
    </VStack>
  );
}
