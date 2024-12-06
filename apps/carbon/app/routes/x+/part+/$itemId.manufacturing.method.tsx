import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { json, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { MakeMethod, Material, MethodOperation } from "~/modules/items";
import {
  getItemManufacturing,
  partManufacturingValidator,
  upsertItemManufacturing,
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  MakeMethodTools,
} from "~/modules/items/ui/Item";
import { PartManufacturingForm } from "~/modules/items/ui/Parts";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partManufacturing] = await Promise.all([
    getItemManufacturing(client, itemId, companyId),
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

  return json({
    partManufacturing: partManufacturing.data,
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
  const { partManufacturing } = useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const manufacturingRouteData = useRouteData<{
    makeMethod: MakeMethod;
    methodMaterials: Material[];
    methodOperations: MethodOperation[];
  }>(path.to.partManufacturing(itemId));

  const makeMethodId = manufacturingRouteData?.makeMethod?.id;
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const manufacturingInitialValues = {
    ...partManufacturing,
    lotSize: partManufacturing.lotSize ?? 0,
    ...getCustomFields(partManufacturing.customFields),
  };

  return (
    <VStack spacing={2} className="p-2">
      <MakeMethodTools itemId={itemId} type="Part" />
      <PartManufacturingForm
        key={itemId}
        initialValues={manufacturingInitialValues}
      />
      <BillOfProcess
        key={`bop:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations ?? []}
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        materials={manufacturingRouteData?.methodMaterials ?? []}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations}
      />
    </VStack>
  );
}
