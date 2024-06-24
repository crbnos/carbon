import type { JSONContent } from "@carbon/react";
import {
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  VStack,
} from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData, useParams } from "@remix-run/react";
import { redirect } from "remix-typedjson";

import type { MethodItemType, MethodType } from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  PartManufacturingForm,
  getItemManufacturing,
  getMakeMethod,
  getMethodMaterials,
  getMethodOperations,
  partManufacturingValidator,
  upsertItemManufacturing,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partManufacturing, makeMethod] = await Promise.all([
    getItemManufacturing(client, itemId, companyId),
    getMakeMethod(client, itemId, companyId),
  ]);

  if (partManufacturing.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(partManufacturing.error, "Failed to load part manufacturing")
      )
    );
  }

  if (makeMethod.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(makeMethod.error, "Failed to load make method")
      )
    );
  }

  const [methodMaterials, methodOperations] = await Promise.all([
    getMethodMaterials(client, makeMethod.data.id),
    getMethodOperations(client, makeMethod.data.id),
  ]);
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

  return json({
    partManufacturing: partManufacturing.data,
    makeMethod: makeMethod.data,
    methodMaterials:
      methodMaterials.data?.map((m) => ({
        ...m,
        methodType: m.methodType as MethodType,
        itemType: m.itemType as MethodItemType,
      })) ?? [],
    methodOperations:
      methodOperations.data?.map((operation) => ({
        ...operation,
        equipmentTypeId: operation.equipmentTypeId ?? undefined,
        methodOperationWorkInstruction:
          operation.methodOperationWorkInstruction as {
            content: JSONContent | null;
          },
      })) ?? [],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(partManufacturingValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePartManufacturing = await upsertItemManufacturing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
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
    path.to.partManufacturing(itemId),
    await flash(request, success("Updated part manufacturing"))
  );
}

export default function MakeMethodRoute() {
  const { makeMethod, methodMaterials, methodOperations, partManufacturing } =
    useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const makeMethodId = makeMethod?.id;
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const manufacturingInitialValues = {
    ...partManufacturing,
    lotSize: partManufacturing.lotSize ?? 0,
    ...getCustomFields(partManufacturing.customFields),
  };

  return (
    <>
      <ResizablePanel
        order={2}
        minSize={40}
        defaultSize={60}
        className="border-t border-border"
      >
        <ScrollArea className="h-[calc(100vh-99px)]">
          <VStack spacing={2} className="p-2">
            <PartManufacturingForm
              key={itemId}
              initialValues={manufacturingInitialValues}
            />
            <BillOfMaterial
              key={itemId}
              makeMethodId={makeMethodId}
              materials={methodMaterials}
            />
            <BillOfProcess
              key={itemId}
              makeMethodId={makeMethodId}
              operations={methodOperations}
            />
          </VStack>
        </ScrollArea>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        order={3}
        minSize={10}
        defaultSize={20}
        className="bg-card"
      >
        <ScrollArea className="h-[calc(100vh-99px)]">
          <VStack spacing={2} className="px-4 py-2">
            <h3 className="text-xs text-muted-foreground">Properties</h3>
          </VStack>
        </ScrollArea>
      </ResizablePanel>
    </>
  );
}
