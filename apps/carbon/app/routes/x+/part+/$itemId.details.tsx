import { VStack } from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import { useAutodeskToken } from "~/lib/autodesk";
import type { PartSummary } from "~/modules/items";
import { PartForm, partValidator, upsertPart } from "~/modules/items";
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

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(partValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePart = await upsertPart(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
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

export default function PartDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const partData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );
  if (!partData) throw new Error("Could not find part data");

  const partInitialValues = {
    id: partData.partSummary?.id ?? "",
    itemId: partData.partSummary?.itemId ?? "",
    name: partData.partSummary?.name ?? "",
    description: partData.partSummary?.description ?? "",
    replenishmentSystem: partData.partSummary?.replenishmentSystem ?? "Buy",
    defaultMethodType: partData.partSummary?.defaultMethodType ?? "Buy",
    itemTrackingType: partData.partSummary?.itemTrackingType ?? "Inventory",
    active: partData.partSummary?.active ?? true,
    unitOfMeasureCode: partData.partSummary?.unitOfMeasureCode ?? "EA",
    ...getCustomFields(partData.partSummary?.customFields ?? {}),
  };

  const { autodeskToken } = useAutodeskToken();

  return (
    <VStack spacing={2} className="p-2">
      <PartForm key={partInitialValues.id} initialValues={partInitialValues} />
      <pre className="p-2">{autodeskToken}</pre>
    </VStack>
  );
}
