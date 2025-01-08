import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import {
  Await,
  defer,
  redirect,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Suspense } from "react";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks/usePermissions";
import {
  getItem,
  getMethodMaterial,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId,
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  ItemForm,
  MakeMethodTools,
} from "~/modules/items/ui/Item";
import {
  getModelByItemId,
  type MethodItemType,
  type MethodType,
} from "~/modules/shared";
import { path } from "~/utils/path";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId, materialId, makeMethodId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!materialId) throw new Error("Could not find materialId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const [material, methodMaterials, methodOperations] = await Promise.all([
    getMethodMaterial(client, materialId),
    getMethodMaterialsByMakeMethod(client, makeMethodId),
    getMethodOperationsByMakeMethodId(client, makeMethodId),
  ]);

  if (material.error) {
    throw redirect(
      path.to.toolDetails(itemId),
      await flash(request, error(material.error, "Failed to load material"))
    );
  }

  if (methodOperations.error) {
    throw redirect(
      path.to.toolDetails(itemId),
      await flash(
        request,
        error(methodOperations.error, "Failed to load method operations")
      )
    );
  }
  if (methodMaterials.error) {
    throw redirect(
      path.to.toolDetails(itemId),
      await flash(
        request,
        error(methodMaterials.error, "Failed to load method materials")
      )
    );
  }

  const item = await getItem(client, material.data.itemId);
  if (item.error) {
    throw redirect(
      path.to.toolDetails(itemId),
      await flash(request, error(item.error, "Failed to load item"))
    );
  }

  return defer({
    item: {
      ...item.data,
      defaultMethodType: item.data.defaultMethodType ?? "Buy",
      unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
      description: item.data.description ?? "",
    },
    material: material.data,
    methodMaterials:
      methodMaterials.data?.map((m) => ({
        ...m,
        description: m.item?.name ?? "",
        methodType: m.methodType as MethodType,
        itemType: m.itemType as MethodItemType,
        methodOperationId: m.methodOperationId ?? undefined,
      })) ?? [],
    methodOperations:
      methodOperations.data?.map((operation) => ({
        ...operation,
        workCenterId: operation.workCenterId ?? undefined,
        operationSupplierProcessId:
          operation.operationSupplierProcessId ?? undefined,
        workInstruction: operation.workInstruction as JSONContent | null,
      })) ?? [],
    model: getModelByItemId(client, material.data.itemId),
  });
}

export default function MethodMaterialMakePage() {
  const permissions = usePermissions();
  const loaderData = useLoaderData<typeof loader>();
  const { item, methodMaterials, methodOperations } = loaderData;

  const { itemId, makeMethodId, materialId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");
  if (!materialId) throw new Error("Could not find materialId");

  return (
    <VStack spacing={2} className="p-2">
      <MakeMethodTools itemId={item.id} type="Tool" />
      <ItemForm
        key={`item:${itemId}:${makeMethodId}:${materialId}`}
        type={item.type}
        initialValues={item}
      />
      <BillOfProcess
        key={`bop:${itemId}`}
        makeMethodId={makeMethodId}
        operations={methodOperations}
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethodId={makeMethodId}
        materials={methodMaterials}
        operations={methodOperations}
      />
      <Suspense fallback={null}>
        <Await resolve={loaderData.model}>
          {(model) => (
            <CadModel
              key={`cad:${model.itemId}`}
              isReadOnly={!permissions.can("update", "sales")}
              metadata={{
                itemId: model?.itemId ?? undefined,
              }}
              modelPath={model?.modelPath ?? null}
              title="CAD Model"
              uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
              viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
            />
          )}
        </Await>
      </Suspense>
    </VStack>
  );
}
