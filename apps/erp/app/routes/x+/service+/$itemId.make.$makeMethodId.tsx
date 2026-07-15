import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { Menubar, VStack } from "@carbon/react";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ServiceSummary } from "~/modules/items";
import {
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
import { getTagsList } from "~/modules/shared";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { itemId, makeMethodId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const [makeMethod, methodMaterials, methodOperations, tags] =
    await Promise.all([
      getMakeMethodById(client, makeMethodId, companyId),
      getMethodMaterialsByMakeMethod(client, makeMethodId),
      getMethodOperationsByMakeMethodId(client, makeMethodId),
      getTagsList(client, companyId, "operation")
    ]);

  if (makeMethod.error) {
    throw redirect(
      path.to.serviceDetails(itemId),
      await flash(
        request,
        error(makeMethod.error, "Failed to load make method")
      )
    );
  }

  if (methodOperations.error) {
    throw redirect(
      path.to.serviceDetails(itemId),
      await flash(
        request,
        error(methodOperations.error, "Failed to load method operations")
      )
    );
  }
  if (methodMaterials.error) {
    throw redirect(
      path.to.serviceDetails(itemId),
      await flash(
        request,
        error(methodMaterials.error, "Failed to load method materials")
      )
    );
  }

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
    makeMethods: getMakeMethods(client, makeMethod.data.itemId, companyId),
    tags: tags.data ?? []
  };
}

export default function ServiceMakeMethodPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { makeMethod, makeMethods, methodMaterials, methodOperations, tags } =
    loaderData;

  const { itemId, makeMethodId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const serviceData = useRouteData<{
    serviceSummary: ServiceSummary;
  }>(path.to.service(itemId));

  return (
    <VStack spacing={2} className="p-2">
      <Suspense fallback={<Menubar />}>
        <Await resolve={makeMethods}>
          {(makeMethods) => (
            <MakeMethodTools
              itemId={makeMethod.itemId}
              makeMethods={makeMethods.data ?? []}
              type="Service"
              currentMethodId={makeMethod.id}
            />
          )}
        </Await>
      </Suspense>

      <BillOfMaterial
        key={`bom:${makeMethodId}`}
        makeMethod={makeMethod}
        // @ts-expect-error TS2322 - TODO: fix type
        materials={methodMaterials}
        operations={methodOperations}
        replenishmentSystem={serviceData?.serviceSummary?.replenishmentSystem}
      />
      <BillOfProcess
        key={`bop:${makeMethodId}`}
        makeMethod={makeMethod}
        materials={methodMaterials}
        // @ts-expect-error
        operations={methodOperations}
        tags={tags}
      />
    </VStack>
  );
}
