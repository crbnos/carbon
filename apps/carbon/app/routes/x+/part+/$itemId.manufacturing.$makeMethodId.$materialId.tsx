import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";

import {
  BillOfMaterial,
  BillOfProcess,
  ItemForm,
  getItem,
  getMethodMaterial,
  getMethodMaterials,
  getMethodOperations,
} from "~/modules/items";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";
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
    getMethodMaterials(client, makeMethodId),
    getMethodOperations(client, makeMethodId),
  ]);

  if (material.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(request, error(material.error, "Failed to load material"))
    );
  }

  if (methodOperations.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(methodOperations.error, "Failed to load method operations")
      )
    );
  }
  if (methodMaterials.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(methodMaterials.error, "Failed to load method materials")
      )
    );
  }

  const item = await getItem(client, material.data.itemId);
  if (item.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(request, error(item.error, "Failed to load item"))
    );
  }

  return json({
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
        methodOperationId: m.methodOperationId ?? undefined,
        methodType: m.methodType as MethodType,
        itemType: m.itemType as MethodItemType,
      })) ?? [],
    methodOperations:
      methodOperations.data?.map((operation) => ({
        ...operation,
        workCenterId: operation.workCenterId ?? undefined,
        operationSupplierProcessId:
          operation.operationSupplierProcessId ?? undefined,
        methodOperationWorkInstruction:
          operation.methodOperationWorkInstruction as {
            content: JSONContent | null;
          },
      })) ?? [],
  });
}

export default function MethodMaterialMakePage() {
  const { item, methodMaterials, methodOperations } =
    useLoaderData<typeof loader>();
  const { itemId, makeMethodId, materialId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");
  if (!materialId) throw new Error("Could not find materialId");

  return (
    <VStack spacing={2} className="p-2">
      <ItemForm
        key={`item:${itemId}:${makeMethodId}:${materialId}`}
        type={item.type}
        initialValues={item}
      />
      <BillOfProcess
        key={`bop:${itemId}:${makeMethodId}:${materialId}`}
        makeMethodId={makeMethodId}
        operations={methodOperations}
      />
      <BillOfMaterial
        key={`bom:${itemId}:${makeMethodId}:${materialId}`}
        makeMethodId={makeMethodId}
        materials={methodMaterials}
        operations={methodOperations}
      />
    </VStack>
  );
}
