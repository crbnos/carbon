import { VStack } from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { PartSummary } from "~/modules/parts";
import { ItemForm, PartForm, partValidator, upsertPart } from "~/modules/parts";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { partId } = params;
  if (!partId) throw new Error("Could not find partId");

  const formData = await request.formData();
  const validation = await validator(partValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePart = await upsertPart(client, {
    ...validation.data,
    id: partId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updatePart.error) {
    throw redirect(
      path.to.part(partId),
      await flash(request, error(updatePart.error, "Failed to update part"))
    );
  }

  throw redirect(
    path.to.part(partId),
    await flash(request, success("Updated part"))
  );
}

export default function PartDetailsRoute() {
  const { partId } = useParams();
  if (!partId) throw new Error("Could not find partId");
  const partData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(partId)
  );
  if (!partData) throw new Error("Could not find part data");

  const itemInitialValues = {
    id: partData.partSummary?.itemId ?? "",
    readableId: partData.partSummary?.id ?? "",
    name: partData.partSummary?.name ?? "",
    description: partData.partSummary?.description ?? "",
    partGroupId: partData.partSummary?.partGroupId ?? "",
    active: partData.partSummary?.active ?? true,
    blocked: partData.partSummary?.blocked ?? false,
  };

  const partInitialValues = {
    id: partData.partSummary?.id ?? "",
    partType: partData.partSummary?.partType ?? "Inventory",
    replenishmentSystem: partData.partSummary?.replenishmentSystem ?? "Buy",
    unitOfMeasureCode: partData.partSummary?.unitOfMeasureCode ?? "EA",
    ...getCustomFields(partData.partSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={4}>
      <ItemForm
        key={itemInitialValues.id}
        type="part"
        initialValues={itemInitialValues}
      />
      <PartForm key={partInitialValues.id} initialValues={partInitialValues} />
    </VStack>
  );
}
