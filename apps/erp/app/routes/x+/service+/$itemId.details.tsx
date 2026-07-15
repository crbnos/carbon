import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Menubar, VStack } from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, MakeMethod, ServiceSummary } from "~/modules/items";
import {
  getMakeMethodById,
  getMakeMethods,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId,
  serviceValidator,
  upsertService
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  ItemDocuments,
  ItemNotes,
  ItemRiskRegister,
  MakeMethodTools
} from "~/modules/items/ui/Item";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { getTagsList } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const url = new URL(request.url);
  const requestedMethodId = url.searchParams.get("methodId");

  const makeMethods = await getMakeMethods(client, itemId, companyId);
  const makeMethod = requestedMethodId
    ? (makeMethods.data?.find((m) => m.id === requestedMethodId) ??
      makeMethods.data?.find((m) => m.status === "Active") ??
      makeMethods.data?.[0])
    : (makeMethods.data?.find((m) => m.status === "Active") ??
      makeMethods.data?.[0]);

  if (!makeMethod) {
    return { methodData: null, tags: [] };
  }

  const fullMethod = await getMakeMethodById(client, makeMethod.id, companyId);
  if (fullMethod.error || !fullMethod.data) {
    return { methodData: null, tags: [] };
  }

  const [methodMaterials, methodOperations, tags] = await Promise.all([
    getMethodMaterialsByMakeMethod(client, fullMethod.data.id),
    getMethodOperationsByMakeMethodId(client, fullMethod.data.id),
    getTagsList(client, companyId, "operation")
  ]);

  return {
    methodData: {
      makeMethod: fullMethod.data,
      methodMaterials:
        methodMaterials.data?.map((m) => ({
          ...m,
          description: m.item?.name ?? "",
          methodType: m.methodType as MethodType,
          itemType: m.itemType as MethodItemType
        })) ?? [],
      methodOperations:
        methodOperations.data?.map((operation) => ({
          ...operation,
          workCenterId: operation.workCenterId ?? undefined,
          operationSupplierProcessId:
            operation.operationSupplierProcessId ?? undefined,
          workInstruction: operation.workInstruction as JSONContent | null
        })) ?? []
    },
    tags: tags.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();

  const validation = await validator(serviceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateService = await upsertService(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updateService.error) {
    throw redirect(
      path.to.service(itemId),
      await flash(
        request,
        error(updateService.error, "Failed to update service")
      )
    );
  }

  throw redirect(
    path.to.service(itemId),
    await flash(request, success("Updated service"))
  );
}

export default function ServiceDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const permissions = usePermissions();
  const { methodData, tags } = useLoaderData<typeof loader>();

  const serviceData = useRouteData<{
    serviceSummary: ServiceSummary;
    files: Promise<ItemFile[]>;
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
  }>(path.to.service(itemId));

  if (!serviceData) throw new Error("Could not find service data");

  return (
    <VStack spacing={2} className="p-2">
      {permissions.is("employee") && methodData && (
        <>
          <Suspense fallback={<Menubar />}>
            <Await resolve={serviceData?.makeMethods}>
              {(makeMethods) => (
                <MakeMethodTools
                  itemId={methodData.makeMethod.itemId}
                  makeMethods={makeMethods?.data ?? []}
                  type="Service"
                  currentMethodId={methodData.makeMethod.id}
                />
              )}
            </Await>
          </Suspense>

          <ItemNotes
            id={serviceData.serviceSummary?.id ?? null}
            title={serviceData.serviceSummary?.name ?? ""}
            subTitle={serviceData.serviceSummary?.readableIdWithRevision ?? ""}
            notes={serviceData.serviceSummary?.notes as JSONContent}
          />
          {serviceData.serviceSummary?.replenishmentSystem === "Make" && (
            <>
              <BillOfMaterial
                key={`bom:${itemId}`}
                makeMethod={methodData.makeMethod}
                // @ts-ignore
                materials={methodData.methodMaterials ?? []}
                // @ts-ignore
                operations={methodData.methodOperations}
                replenishmentSystem={
                  serviceData.serviceSummary?.replenishmentSystem
                }
              />
              <BillOfProcess
                key={`bop:${itemId}`}
                makeMethod={methodData.makeMethod}
                // @ts-ignore
                operations={methodData.methodOperations ?? []}
                tags={tags}
              />
            </>
          )}
        </>
      )}
      {permissions.is("employee") && (
        <>
          <DeferredFiles resolve={serviceData?.files}>
            {(resolvedFiles) => (
              <ItemDocuments
                files={resolvedFiles}
                itemId={itemId}
                type="Service"
              />
            )}
          </DeferredFiles>

          <ItemRiskRegister itemId={itemId} />
        </>
      )}
    </VStack>
  );
}
