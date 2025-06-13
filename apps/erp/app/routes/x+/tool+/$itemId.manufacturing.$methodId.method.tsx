import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError } from "@carbon/form";
import { Menubar, VStack } from "@carbon/react";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Suspense } from "react";
import type { z } from "zod";
import CadModel from "~/components/CadModel";
import { usePermissions, useRouteData } from "~/hooks";
import {
  itemManufacturingValidator,
  upsertItemManufacturing,
  type MakeMethod,
  type Material,
  type MethodOperation,
  type ToolSummary,
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  MakeMethodTools,
} from "~/modules/items/ui/Item";
import ItemManufacturingForm from "~/modules/items/ui/Item/ItemManufacturingForm";
import { getTagsList } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { validator } from "../../../../../../packages/form/src/zod";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const tags = await getTagsList(client, companyId, "operation");

  return json({ tags: tags.data ?? [] });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId, methodId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!methodId) throw new Error("Could not find methodId");

  const formData = await request.formData();
  const validation = await validator(itemManufacturingValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateToolManufacturing = await upsertItemManufacturing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
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
    path.to.toolMakeMethod(itemId, methodId),
    await flash(request, success("Updated part manufacturing"))
  );
}

export default function MakeMethodRoute() {
  const permissions = usePermissions();
  const { itemId, methodId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!methodId) throw new Error("Could not find methodId");

  const { tags } = useLoaderData<typeof loader>();

  const itemRouteData = useRouteData<{
    toolSummary: ToolSummary;
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
  }>(path.to.tool(itemId));

  const manufacturingRouteData = useRouteData<{
    toolManufacturing: z.infer<typeof itemManufacturingValidator> & {
      customFields: Record<string, string>;
    };
    makeMethod: MakeMethod;
    methodMaterials: Material[];
    methodOperations: MethodOperation[];
  }>(path.to.toolMethod(itemId, methodId));

  if (!manufacturingRouteData) throw new Error("Could not find route data");

  const makeMethodId = manufacturingRouteData?.makeMethod?.id;
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const manufacturingInitialValues = {
    ...manufacturingRouteData?.toolManufacturing,
    lotSize: manufacturingRouteData?.toolManufacturing.lotSize ?? 0,
    ...getCustomFields(manufacturingRouteData?.toolManufacturing.customFields),
  };

  return (
    <VStack spacing={2} className="p-2">
      <Suspense fallback={<Menubar />}>
        <Await resolve={itemRouteData?.makeMethods}>
          {(makeMethods) => (
            <MakeMethodTools
              itemId={manufacturingRouteData?.makeMethod.itemId}
              makeMethods={makeMethods?.data ?? []}
              type="Tool"
            />
          )}
        </Await>
      </Suspense>
      <ItemManufacturingForm
        key={itemId}
        // @ts-ignore
        initialValues={manufacturingInitialValues}
        withConfiguration={false}
      />
      <BillOfProcess
        key={`bop:${itemId}`}
        makeMethod={manufacturingRouteData?.makeMethod}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations ?? []}
        tags={tags}
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethod={manufacturingRouteData?.makeMethod}
        // @ts-ignore
        materials={manufacturingRouteData?.methodMaterials ?? []}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations}
      />

      <CadModel
        isReadOnly={!permissions.can("update", "parts")}
        metadata={{ itemId }}
        modelPath={itemRouteData?.toolSummary?.modelPath ?? null}
        title="CAD Model"
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />
    </VStack>
  );
}
