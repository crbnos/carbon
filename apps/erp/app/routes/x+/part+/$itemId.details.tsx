import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Menubar, Spinner, VStack } from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense } from "react";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, MakeMethod, PartSummary } from "~/modules/items";
import {
  getConfigurationParameters,
  getConfigurationRules,
  getItemManufacturing,
  getMakeMethodById,
  getMakeMethods,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId,
  itemManufacturingValidator,
  partValidator,
  upsertItemManufacturing,
  upsertPart
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  ItemDocuments,
  ItemNotes,
  ItemRiskRegister,
  MakeMethodTools
} from "~/modules/items/ui/Item";
import ItemManufacturingForm from "~/modules/items/ui/Item/ItemManufacturingForm";
import { ConfigurationParametersForm } from "~/modules/items/ui/Parts";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { getTagsList } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { configurableItemsQuery, getCompanyId } from "~/utils/react-query";

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

  const [methodMaterials, methodOperations, tags, partManufacturing] =
    await Promise.all([
      getMethodMaterialsByMakeMethod(client, fullMethod.data.id),
      getMethodOperationsByMakeMethodId(client, fullMethod.data.id),
      getTagsList(client, companyId, "operation"),
      getItemManufacturing(client, itemId, companyId)
    ]);

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
        })) ?? [],
      partManufacturing: partManufacturing.data,
      ...configData
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
  const intent = formData.get("intent");

  if (intent === "manufacturing") {
    const validation = await validator(itemManufacturingValidator).validate(
      formData
    );

    if (validation.error) {
      console.error(validation.error);
      return validationError(validation.error);
    }

    const updatePartManufacturing = await upsertItemManufacturing(client, {
      ...validation.data,
      requiresConfiguration: validation.data.requiresConfiguration ?? false,
      itemId,
      updatedBy: userId,
      customFields: setCustomFields(formData)
    });
    if (updatePartManufacturing.error) {
      throw redirect(
        path.to.part(itemId),
        await flash(
          request,
          error(
            updatePartManufacturing.error,
            "Failed to update part manufacturing"
          )
        )
      );
    }

    throw redirect(
      path.to.partDetails(itemId),
      await flash(request, success("Updated part manufacturing"))
    );
  }

  const validation = await validator(partValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePart = await upsertPart(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updatePart.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(request, error(updatePart.error, "Failed to update part"))
    );
  }

  throw redirect(
    path.to.part(itemId),
    await flash(request, success("Updated part"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    configurableItemsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function PartDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const permissions = usePermissions();
  const { methodData, tags } = useLoaderData<typeof loader>();

  const partData = useRouteData<{
    partSummary: PartSummary;
    files: Promise<ItemFile[]>;
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
  }>(path.to.part(itemId));

  if (!partData) throw new Error("Could not find part data");

  const manufacturingInitialValues = methodData?.partManufacturing
    ? {
        ...methodData.partManufacturing,
        lotSize: methodData.partManufacturing.lotSize ?? 0,
        ...getCustomFields(methodData.partManufacturing.customFields)
      }
    : null;

  return (
    <VStack spacing={2} className="p-2">
      {permissions.is("employee") && methodData && (
        <>
          <Suspense fallback={<Menubar />}>
            <Await resolve={partData?.makeMethods}>
              {(makeMethods) => (
                <MakeMethodTools
                  itemId={methodData.makeMethod.itemId}
                  makeMethods={makeMethods?.data ?? []}
                  type="Part"
                  currentMethodId={methodData.makeMethod.id}
                />
              )}
            </Await>
          </Suspense>
          {manufacturingInitialValues && (
            <ItemManufacturingForm
              key={itemId}
              // @ts-ignore
              initialValues={manufacturingInitialValues}
            />
          )}
          {methodData.partManufacturing?.requiresConfiguration && (
            <ConfigurationParametersForm
              key={`options:${itemId}`}
              parameters={
                methodData.configurationParametersAndGroups.parameters
              }
              groups={methodData.configurationParametersAndGroups.groups}
            />
          )}
          <ItemNotes
            id={partData.partSummary?.id ?? null}
            title={partData.partSummary?.name ?? ""}
            subTitle={partData.partSummary?.readableIdWithRevision ?? ""}
            notes={partData.partSummary?.notes as JSONContent}
          />
          <BillOfMaterial
            key={`bom:${itemId}`}
            makeMethod={methodData.makeMethod}
            // @ts-ignore
            materials={methodData.methodMaterials ?? []}
            // @ts-ignore
            operations={methodData.methodOperations}
            configurable={methodData.partManufacturing?.requiresConfiguration}
            configurationRules={methodData.configurationRules}
            parameters={methodData.configurationParametersAndGroups.parameters}
          />
          <BillOfProcess
            key={`bop:${itemId}`}
            makeMethod={methodData.makeMethod}
            // @ts-ignore
            operations={methodData.methodOperations ?? []}
            configurable={methodData.partManufacturing?.requiresConfiguration}
            // @ts-ignore
            materials={methodData.methodMaterials ?? []}
            configurationRules={methodData.configurationRules}
            parameters={methodData.configurationParametersAndGroups.parameters}
            tags={tags}
          />
        </>
      )}
      {permissions.is("employee") && (
        <>
          <Suspense
            fallback={
              <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
                <Spinner className="h-10 w-10" />
              </div>
            }
          >
            <Await resolve={partData?.files}>
              {(resolvedFiles) => (
                <ItemDocuments
                  files={resolvedFiles}
                  itemId={itemId}
                  modelUpload={partData.partSummary ?? undefined}
                  type="Part"
                />
              )}
            </Await>
          </Suspense>

          <CadModel
            isReadOnly={!permissions.can("update", "parts")}
            metadata={{ itemId }}
            modelPath={partData?.partSummary?.modelPath ?? null}
            title="CAD Model"
          />
          <ItemRiskRegister itemId={itemId} />
        </>
      )}
    </VStack>
  );
}
