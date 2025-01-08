import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import type { z } from "zod";
import CadModel from "~/components/CadModel";
import { usePermissions, useRouteData } from "~/hooks";
import type {
  ConfigurationParameter,
  ConfigurationParameterGroup,
  ConfigurationRule,
  MakeMethod,
  Material,
  MethodOperation,
  PartSummary,
} from "~/modules/items";
import {
  partManufacturingValidator,
  upsertItemManufacturing,
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  MakeMethodTools,
} from "~/modules/items/ui/Item";
import {
  ConfigurationParametersForm,
  PartManufacturingForm,
} from "~/modules/items/ui/Parts";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const itemRouteData = useRouteData<{
    partSummary: PartSummary;
  }>(path.to.part(itemId));

  const manufacturingRouteData = useRouteData<{
    partManufacturing: z.infer<typeof partManufacturingValidator> & {
      customFields: Record<string, string>;
    };
    configurationParametersAndGroups: {
      groups: ConfigurationParameterGroup[];
      parameters: ConfigurationParameter[];
    };
    configurationRules: ConfigurationRule[];
    makeMethod: MakeMethod;
    methodMaterials: Material[];
    methodOperations: MethodOperation[];
  }>(path.to.partManufacturing(itemId));

  if (!manufacturingRouteData) throw new Error("Could not find route data");

  const makeMethodId = manufacturingRouteData?.makeMethod?.id;
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const manufacturingInitialValues = {
    ...manufacturingRouteData?.partManufacturing,
    lotSize: manufacturingRouteData?.partManufacturing.lotSize ?? 0,
    ...getCustomFields(manufacturingRouteData?.partManufacturing.customFields),
  };

  return (
    <VStack spacing={2} className="p-2">
      <MakeMethodTools itemId={itemId} type="Part" />
      <PartManufacturingForm
        key={itemId}
        // @ts-ignore
        initialValues={manufacturingInitialValues}
      />
      {manufacturingRouteData?.partManufacturing.requiresConfiguration && (
        <ConfigurationParametersForm
          key={`options:${itemId}`}
          parameters={
            manufacturingRouteData?.configurationParametersAndGroups.parameters
          }
          groups={
            manufacturingRouteData?.configurationParametersAndGroups.groups
          }
        />
      )}

      <BillOfProcess
        key={`bop:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations ?? []}
        configurable={
          manufacturingRouteData?.partManufacturing.requiresConfiguration
        }
        configurationRules={manufacturingRouteData?.configurationRules}
        parameters={
          manufacturingRouteData?.configurationParametersAndGroups.parameters
        }
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        materials={manufacturingRouteData?.methodMaterials ?? []}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations}
        configurable={
          manufacturingRouteData?.partManufacturing.requiresConfiguration
        }
        configurationRules={manufacturingRouteData?.configurationRules}
        parameters={
          manufacturingRouteData?.configurationParametersAndGroups.parameters
        }
      />

      <CadModel
        isReadOnly={!permissions.can("update", "parts")}
        metadata={{ itemId }}
        modelPath={itemRouteData?.partSummary?.modelPath ?? null}
        title="CAD Model"
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />
    </VStack>
  );
}
