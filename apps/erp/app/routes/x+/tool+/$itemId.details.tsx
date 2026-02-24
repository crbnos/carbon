import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Menubar, Spinner, VStack } from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, MakeMethod, ToolSummary } from "~/modules/items";
import {
  getItemManufacturing,
  getMakeMethodById,
  getMakeMethods,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId,
  itemManufacturingValidator,
  toolValidator,
  upsertItemManufacturing,
  upsertTool
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
import type { MethodItemType, MethodType } from "~/modules/shared";
import { getTagsList } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
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

  const [methodMaterials, methodOperations, tags, toolManufacturing] =
    await Promise.all([
      getMethodMaterialsByMakeMethod(client, fullMethod.data.id),
      getMethodOperationsByMakeMethodId(client, fullMethod.data.id),
      getTagsList(client, companyId, "operation"),
      getItemManufacturing(client, itemId, companyId)
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
        })) ?? [],
      toolManufacturing: toolManufacturing.data
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

    const updateToolManufacturing = await upsertItemManufacturing(client, {
      ...validation.data,
      itemId,
      updatedBy: userId,
      customFields: setCustomFields(formData)
    });
    if (updateToolManufacturing.error) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(
            updateToolManufacturing.error,
            "Failed to update tool manufacturing"
          )
        )
      );
    }

    throw redirect(
      path.to.toolDetails(itemId),
      await flash(request, success("Updated tool manufacturing"))
    );
  }

  const validation = await validator(toolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateTool = await upsertTool(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updateTool.error) {
    throw redirect(
      path.to.tool(itemId),
      await flash(request, error(updateTool.error, "Failed to update tool"))
    );
  }

  throw redirect(
    path.to.tool(itemId),
    await flash(request, success("Updated tool"))
  );
}

export default function ToolDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const permissions = usePermissions();
  const { methodData, tags } = useLoaderData<typeof loader>();

  const toolData = useRouteData<{
    toolSummary: ToolSummary;
    files: Promise<ItemFile[]>;
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
  }>(path.to.tool(itemId));

  if (!toolData) throw new Error("Could not find tool data");

  const manufacturingInitialValues = methodData?.toolManufacturing
    ? {
        ...methodData.toolManufacturing,
        lotSize: methodData.toolManufacturing.lotSize ?? 0,
        ...getCustomFields(methodData.toolManufacturing.customFields)
      }
    : null;

  return (
    <VStack spacing={2} className="p-2">
      {permissions.is("employee") && methodData && (
        <>
          <Suspense fallback={<Menubar />}>
            <Await resolve={toolData?.makeMethods}>
              {(makeMethods) => (
                <MakeMethodTools
                  itemId={methodData.makeMethod.itemId}
                  makeMethods={makeMethods?.data ?? []}
                  type="Tool"
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
              withConfiguration={false}
            />
          )}
          <ItemNotes
            id={toolData.toolSummary?.id ?? null}
            title={toolData.toolSummary?.name ?? ""}
            subTitle={toolData.toolSummary?.readableIdWithRevision ?? ""}
            notes={toolData.toolSummary?.notes as JSONContent}
          />
          <BillOfMaterial
            key={`bom:${itemId}`}
            makeMethod={methodData.makeMethod}
            // @ts-ignore
            materials={methodData.methodMaterials ?? []}
            // @ts-ignore
            operations={methodData.methodOperations}
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
      {permissions.is("employee") && (
        <>
          <Suspense
            fallback={
              <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
                <Spinner className="h-10 w-10" />
              </div>
            }
          >
            <Await resolve={toolData?.files}>
              {(resolvedFiles) => (
                <ItemDocuments
                  files={resolvedFiles}
                  itemId={itemId}
                  modelUpload={toolData.toolSummary ?? undefined}
                  type="Tool"
                />
              )}
            </Await>
          </Suspense>

          <CadModel
            isReadOnly={!permissions.can("update", "parts")}
            metadata={{ itemId }}
            modelPath={toolData?.toolSummary?.modelPath ?? null}
            title="CAD Model"
          />

          <ItemRiskRegister itemId={itemId} />
        </>
      )}
    </VStack>
  );
}
