import { requirePermissions } from "@carbon/auth/auth.server";
import { Menubar, VStack } from "@carbon/react";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { Suspense } from "react";
import CadModel from "~/components/CadModel";
import { usePermissions, useRouteData } from "~/hooks";
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
import { getTagsList } from "~/modules/shared";
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
  const { itemId, methodId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!methodId) throw new Error("Could not find methodId");

  const { tags } = useLoaderData<typeof loader>();

  const itemRouteData = useRouteData<{
    toolSummary: ToolSummary;
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
  }>(path.to.tool(itemId));

  const manufacturingRouteData = useRouteData<{
    makeMethod: MakeMethod;
    methodMaterials: Material[];
    methodOperations: MethodOperation[];
  }>(path.to.toolMethod(itemId, methodId));

  if (!manufacturingRouteData) throw new Error("Could not find route data");

  const makeMethodId = manufacturingRouteData?.makeMethod?.id;
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  return (
    <VStack spacing={2} className="p-2">
      <Suspense fallback={<Menubar />}>
        <Await resolve={itemRouteData?.makeMethods}>
          {(makeMethods) => (
            <MakeMethodTools
              itemId={manufacturingRouteData?.makeMethod.itemId}
              makeMethods={makeMethods?.data ?? []}
              type="Tool"
            />
          )}
        </Await>
      </Suspense>

      <BillOfProcess
        key={`bop:${itemId}`}
        makeMethod={manufacturingRouteData?.makeMethod}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations ?? []}
        tags={tags}
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethod={manufacturingRouteData?.makeMethod}
        // @ts-ignore
        materials={manufacturingRouteData?.methodMaterials ?? []}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations}
      />

      <CadModel
        isReadOnly={!permissions.can("update", "parts")}
        metadata={{ itemId }}
        modelPath={itemRouteData?.toolSummary?.modelPath ?? null}
        title="CAD Model"
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />
    </VStack>
  );
}
