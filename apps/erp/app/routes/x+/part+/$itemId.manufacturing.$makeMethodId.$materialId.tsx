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
import { useRouteData } from "@carbon/remix";
import { Suspense } from "react";
import type { z } from "zod";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks/usePermissions";
import type {
  ConfigurationParameter,
  ConfigurationParameterGroup,
  ConfigurationRule,
  partManufacturingValidator,
} from "~/modules/items";
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
  getTagsList,
  type MethodItemType,
  type MethodType,
} from "~/modules/shared";
import { path } from "~/utils/path";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId, materialId, makeMethodId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!materialId) throw new Error("Could not find materialId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const [material, methodMaterials, methodOperations, tags] = await Promise.all(
    [
      getMethodMaterial(client, materialId),
      getMethodMaterialsByMakeMethod(client, makeMethodId),
      getMethodOperationsByMakeMethodId(client, makeMethodId),
      getTagsList(client, companyId, "operation"),
    ]
  );

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
        methodOperationId: m.methodOperationId ?? undefined,
        methodType: m.methodType as MethodType,
        itemType: m.itemType as MethodItemType,
      })) ?? [],
    methodOperations:
      methodOperations.data?.map((operation) => ({
        ...operation,
        description: operation.description ?? "",
        procedureId: operation.procedureId ?? undefined,
        operationSupplierProcessId:
          operation.operationSupplierProcessId ?? undefined,
        operationMinimumCost: operation.operationMinimumCost ?? 0,
        operationLeadTime: operation.operationLeadTime ?? 0,
        operationUnitCost: operation.operationUnitCost ?? 0,
        tags: operation.tags ?? [],
        workCenterId: operation.workCenterId ?? undefined,
        workInstruction: operation.workInstruction as JSONContent | null,
      })) ?? [],
    model: getModelByItemId(client, material.data.itemId),
    tags: tags.data ?? [],
  });
}

export default function MethodMaterialMakePage() {
  const loaderData = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { item, methodMaterials, methodOperations, tags } = loaderData;

  const { itemId, makeMethodId, materialId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");
  if (!materialId) throw new Error("Could not find materialId");

  const routeData = useRouteData<{
    partManufacturing: z.infer<typeof partManufacturingValidator> & {
      customFields: Record<string, string>;
    };
    configurationParametersAndGroups: {
      groups: ConfigurationParameterGroup[];
      parameters: ConfigurationParameter[];
    };
    configurationRules: ConfigurationRule[];
  }>(path.to.partManufacturing(itemId));

  return (
    <VStack spacing={2} className="p-2">
      <MakeMethodTools itemId={item.id} type="Part" />
      <ItemForm
        key={`item:${itemId}:${makeMethodId}:${materialId}`}
        type={item.type}
        initialValues={item}
      />
      <BillOfProcess
        key={`bop:${itemId}`}
        makeMethodId={makeMethodId}
        operations={methodOperations}
        configurable={routeData?.partManufacturing.requiresConfiguration}
        configurationRules={routeData?.configurationRules}
        parameters={routeData?.configurationParametersAndGroups.parameters}
        tags={tags}
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethodId={makeMethodId}
        materials={methodMaterials}
        operations={methodOperations}
        configurable={routeData?.partManufacturing.requiresConfiguration}
        configurationRules={routeData?.configurationRules}
        parameters={routeData?.configurationParametersAndGroups.parameters}
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
