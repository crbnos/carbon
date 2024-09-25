import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, Service } from "~/modules/items";
import {
  ItemDocuments,
  ServiceForm,
  serviceValidator,
  upsertService,
} from "~/modules/items";
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
  const validation = await validator(serviceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePart = await upsertService(client, {
    ...validation.data,
    id: itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updatePart.error) {
    throw redirect(
      path.to.service(itemId),
      await flash(request, error(updatePart.error, "Failed to update part"))
    );
  }

  throw redirect(
    path.to.service(itemId),
    await flash(request, success("Updated part"))
  );
}

export default function ServiceDetailsRoute() {
  const permissions = usePermissions();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const routeData = useRouteData<{ service: Service; files: ItemFile[] }>(
    path.to.service(itemId)
  );
  if (!routeData) throw new Error("Could not find part data");

  const serviceInitialValues = {
    id: routeData.service?.id!,
    name: routeData.service?.name ?? "",
    description: routeData.service?.description ?? undefined,
    serviceType: routeData.service?.serviceType ?? "Internal",
    replenishmentSystem: routeData.service?.replenishmentSystem ?? "Make",
    defaultMethodType: routeData.service?.defaultMethodType ?? "Make",
    itemTrackingType: "Non-Inventory" as const,
    active: routeData.service?.active ?? true,
    unitOfMeasureCode: "EA",
    ...getCustomFields(routeData.service?.customFields),
  };

  return (
    <VStack spacing={2} className="w-full h-full">
      <ServiceForm
        key={serviceInitialValues.id}
        initialValues={serviceInitialValues}
      />
      {permissions.is("employee") && (
        <ItemDocuments
          files={routeData?.files ?? []}
          itemId={itemId}
          type="Material"
        />
      )}
    </VStack>
  );
}
