import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { Menubar, VStack } from "@carbon/react";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks/usePermissions";
import {
  getConfigurationParameters,
  getConfigurationRules,
  getItemManufacturing,
  getMakeMethodById,
  getMakeMethods,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  MakeMethodTools
} from "~/modules/items/ui/Item";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { getModelByItemId, getTagsList } from "~/modules/shared";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { itemId, makeMethodId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const [
    makeMethod,
    methodMaterials,
    methodOperations,
    tags,
    partManufacturing
  ] = await Promise.all([
    getMakeMethodById(client, makeMethodId, companyId),
    getMethodMaterialsByMakeMethod(client, makeMethodId),
    getMethodOperationsByMakeMethodId(client, makeMethodId),
    getTagsList(client, companyId, "operation"),
    getItemManufacturing(client, itemId, companyId)
  ]);

  if (makeMethod.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(makeMethod.error, "Failed to load make method")
      )
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

  const configData = partManufacturing.data?.requiresConfiguration
    ? {
        configurationParametersAndGroups: await getConfigurationParameters(
          client,
          itemId,
          companyId
        ),
        configurationRules: await getConfigurationRules(
          client,
          itemId,
          companyId
        )
      }
    : {
        configurationParametersAndGroups: { groups: [], parameters: [] },
        configurationRules: []
      };

  return {
    makeMethod: makeMethod.data,
    methodMaterials:
      methodMaterials.data?.map((m) => ({
        ...m,
        description: m.item?.name ?? "",
        methodOperationId: m.methodOperationId ?? undefined,
        methodType: m.methodType as MethodType,
        itemType: m.itemType as MethodItemType
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
        workInstruction: operation.workInstruction as JSONContent | null
      })) ?? [],
    partManufacturing: partManufacturing.data,
    ...configData,
    model: getModelByItemId(client, makeMethod.data.itemId),
    makeMethods: getMakeMethods(client, makeMethod.data.itemId, companyId),
    tags: tags.data ?? []
  };
}

export default function PartMakeMethodPage() {
  const loaderData = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const {
    makeMethod,
    makeMethods,
    methodMaterials,
    methodOperations,
    partManufacturing,
    configurationParametersAndGroups,
    configurationRules,
    tags
  } = loaderData;

  const { itemId, makeMethodId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  return (
    <VStack spacing={2} className="p-2">
      <Suspense fallback={<Menubar />}>
        <Await resolve={makeMethods}>
          {(makeMethods) => (
            <MakeMethodTools
              itemId={makeMethod.itemId}
              makeMethods={makeMethods.data ?? []}
              type="Part"
              currentMethodId={makeMethod.id}
            />
          )}
        </Await>
      </Suspense>

      <BillOfMaterial
        key={`bom:${makeMethodId}`}
        makeMethod={makeMethod}
        materials={methodMaterials}
        operations={methodOperations}
        configurable={partManufacturing?.requiresConfiguration}
        configurationRules={configurationRules}
        parameters={configurationParametersAndGroups.parameters}
      />
      <BillOfProcess
        key={`bop:${makeMethodId}`}
        makeMethod={makeMethod}
        materials={methodMaterials}
        // @ts-ignore
        operations={methodOperations}
        configurable={partManufacturing?.requiresConfiguration}
        configurationRules={configurationRules}
        parameters={configurationParametersAndGroups.parameters}
        tags={tags}
      />
      <Suspense fallback={null}>
        <Await resolve={loaderData.model}>
          {(model) => (
            <CadModel
              key={`cad:${model.itemId}`}
              isReadOnly={!permissions.can("update", "parts")}
              metadata={{
                itemId: model?.itemId ?? undefined
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
