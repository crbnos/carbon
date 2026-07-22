import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { Menubar, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, MakeMethod, ToolSummary } from "~/modules/items";
import {
  getItemChangeOrderData,
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
import { getRevisionLock } from "~/modules/items/items.server";
import {
  ItemChangeOrders,
  ItemOpenChangeOrderAlert
} from "~/modules/items/ui/ChangeOrder";
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

const logger = getLogger("erp", "itemid-details");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const url = new URL(request.url);
  const requestedMethodId = url.searchParams.get("methodId");

  const [makeMethods, revisionLock, changeOrderData] = await Promise.all([
    getMakeMethods(client, itemId, companyId),
    getRevisionLock(client, { itemId, companyId }),
    // Tool → CO traceability (4b): CO history for this tool + type labels.
    getItemChangeOrderData(client, itemId, companyId)
  ]);
  const revisionStatus = revisionLock.revisionStatus;
  const releaseControl = revisionLock.releaseControl;
  // Include CO-owned draft methods so a revision/new-part item created by an open
  // Change Order still shows its BOM/BOP on the item master. The draft is the same
  // makeMethod the CO edits, so the two surfaces stay in sync. Active is still
  // preferred below, so a Version CO's item keeps its live method as the default.
  const selectable = makeMethods.data ?? [];
  const makeMethod = requestedMethodId
    ? (selectable.find((m) => m.id === requestedMethodId) ??
      selectable.find((m) => m.status === "Active") ??
      selectable[0])
    : (selectable.find((m) => m.status === "Active") ?? selectable[0]);

  if (!makeMethod) {
    return {
      methodData: null,
      tags: [],
      revisionStatus,
      releaseControl,
      ...changeOrderData
    };
  }

  const fullMethod = await getMakeMethodById(client, makeMethod.id, companyId);
  if (fullMethod.error || !fullMethod.data) {
    return {
      methodData: null,
      tags: [],
      revisionStatus,
      releaseControl,
      ...changeOrderData
    };
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
    tags: tags.data ?? [],
    revisionStatus,
    releaseControl,
    ...changeOrderData
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
      logger.error(validation.error);
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
  const { t } = useLingui();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const permissions = usePermissions();
  const {
    methodData,
    tags,
    revisionStatus,
    releaseControl,
    changeOrders,
    changeOrderTypes
  } = useLoaderData<typeof loader>();

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
      {permissions.is("employee") && (
        <ItemOpenChangeOrderAlert changeOrders={changeOrders ?? []} />
      )}
      {permissions.is("employee") && methodData && (
        <>
          {["Make", "Buy and Make"].includes(
            toolData.toolSummary?.replenishmentSystem ?? ""
          ) && (
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
            </>
          )}
          <ItemNotes
            id={toolData.toolSummary?.id ?? null}
            title={toolData.toolSummary?.name ?? ""}
            subTitle={toolData.toolSummary?.readableIdWithRevision ?? ""}
            notes={toolData.toolSummary?.notes as JSONContent}
          />
          {["Make", "Buy and Make"].includes(
            toolData.toolSummary?.replenishmentSystem ?? ""
          ) && (
            <>
              <BillOfMaterial
                key={`bom:${itemId}`}
                makeMethod={methodData.makeMethod}
                // @ts-ignore
                materials={methodData.methodMaterials ?? []}
                // @ts-ignore
                operations={methodData.methodOperations}
                replenishmentSystem={toolData.toolSummary?.replenishmentSystem}
                revisionStatus={revisionStatus}
                releaseControl={releaseControl}
              />
              <BillOfProcess
                key={`bop:${itemId}`}
                makeMethod={methodData.makeMethod}
                // @ts-ignore
                operations={methodData.methodOperations ?? []}
                tags={tags}
                revisionStatus={revisionStatus}
                releaseControl={releaseControl}
              />
            </>
          )}
        </>
      )}
      {permissions.is("employee") && (
        <>
          <DeferredFiles resolve={toolData?.files}>
            {(resolvedFiles) => (
              <ItemDocuments
                files={resolvedFiles}
                itemId={itemId}
                modelUpload={toolData.toolSummary ?? undefined}
                type="Tool"
              />
            )}
          </DeferredFiles>

          <CadModel
            isReadOnly={!permissions.can("update", "parts")}
            metadata={{ itemId }}
            modelPath={toolData?.toolSummary?.modelPath ?? null}
            title={t`CAD Model`}
          />

          <ItemRiskRegister itemId={itemId} />
          <ItemChangeOrders
            changeOrders={changeOrders ?? []}
            types={changeOrderTypes ?? []}
          />
        </>
      )}
    </VStack>
  );
}
