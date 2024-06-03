import { VStack } from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { Service } from "~/modules/parts";
import { ServiceForm, serviceValidator, upsertService } from "~/modules/parts";
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
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const routeData = useRouteData<{ service: Service }>(path.to.service(itemId));
  if (!routeData) throw new Error("Could not find part data");

  const serviceInitialValues = {
    id: routeData.service?.id!,
    name: routeData.service?.name ?? "",
    description: routeData.service?.description ?? undefined,
    serviceType: routeData.service?.serviceType ?? "Internal",
    itemGroupId: routeData.service?.itemGroupId ?? undefined,
    active: routeData.service?.active ?? true,
    blocked: routeData.service?.blocked ?? false,
    ...getCustomFields(routeData.service?.customFields),
  };

  return (
    <VStack spacing={4}>
      <ServiceForm
        key={serviceInitialValues.id}
        initialValues={serviceInitialValues}
      />
    </VStack>
  );
}
