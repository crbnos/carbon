// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { dataOrThrow } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { Menubar, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { getMethodCorrectionsData } from "~/modules/items/items.service";
import type { ServiceSummary } from "~/modules/items/types";
import {
  BillOfMaterial,
  BillOfProcess,
  ItemDocuments,
  MakeMethodTools,
  MethodCorrections
} from "~/modules/items/ui/Item";
import { toMethodCorrectionsProps } from "~/modules/items/ui/Item/MethodCorrections";
import type {
  ItemType,
  MethodItemType,
  MethodType
} from "~/modules/shared/types";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api, client, companyId } = await authorize(request, {
    "parts.services": "View"
  });

  const { itemId, makeMethodId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const [makeMethod, methodMaterials, methodOperations, tags] =
    await Promise.all([
      api.items.getMakeMethodById({ makeMethodId }),
      api.items.getMethodMaterialsByMakeMethod({ makeMethodId }),
      api.items.getMethodOperationsByMakeMethodId({ makeMethodId }),
      api.shared.getTagsList({ table: "operation" })
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

  // A subcomponent opens on its top-level item's route, so its type can differ
  // from the route's: the Files card checks permissions and records uploads by it.
  const [methodCorrections, subItem] = await Promise.all([
    getMethodCorrectionsData(client, makeMethodId, companyId),
    api.items.getItem({ id: makeMethod.data.itemId }).then(dataOrThrow)
  ]);

  return {
    corrections: toMethodCorrectionsProps(methodCorrections.data),
    itemType: subItem.type as ItemType,
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
        assemblyInstructionId: operation.assemblyInstructionId ?? undefined,
        inspectionDocumentId: operation.inspectionDocumentId ?? undefined,
        operationSupplierProcessId:
          operation.operationSupplierProcessId ?? undefined,
        operationMinimumCost: operation.operationMinimumCost ?? 0,
        operationLeadTime: operation.operationLeadTime ?? 0,
        operationUnitCost: operation.operationUnitCost ?? 0,
        tags: operation.tags ?? [],
        workCenterId: operation.workCenterId ?? undefined,
        workInstruction: operation.workInstruction as JSONContent | null
      })) ?? [],
    files: api.items
      .getItemFiles({ itemId: makeMethod.data.itemId })
      .then(dataOrThrow),
    makeMethods: api.items.getMakeMethods({ itemId: makeMethod.data.itemId }),
    tags: tags.data ?? []
  };
}

export default function ServiceMakeMethodPage() {
  const loaderData = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { makeMethod, makeMethods, methodMaterials, methodOperations, tags } =
    loaderData;

  const { itemId, makeMethodId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const serviceData = useRouteData<{
    serviceSummary: ServiceSummary;
  }>(path.to.service(itemId));

  return (
    <VStack spacing={4} className="p-4">
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

      <BillOfProcess
        key={`bop:${makeMethodId}`}
        makeMethod={makeMethod}
        materials={methodMaterials}
        // @ts-expect-error
        operations={methodOperations}
        tags={tags}
      />
      <BillOfMaterial
        key={`bom:${makeMethodId}`}
        makeMethod={makeMethod}
        // @ts-expect-error TS2322 - TODO: fix type
        materials={methodMaterials}
        operations={methodOperations}
        replenishmentSystem={serviceData?.serviceSummary?.replenishmentSystem}
      />
      <MethodCorrections
        key={`corrections:${makeMethod.id}`}
        makeMethod={makeMethod}
        {...loaderData.corrections}
        routingOperations={methodOperations as never}
        tags={tags}
      />
      {permissions.is("employee") && (
        <DeferredFiles resolve={loaderData.files}>
          {(files) => (
            <ItemDocuments
              files={files}
              itemId={makeMethod.itemId}
              type={loaderData.itemType}
            />
          )}
        </DeferredFiles>
      )}
    </VStack>
  );
}
