import { VStack } from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { Service } from "~/modules/parts";
import {
  ItemForm,
  ServiceForm,
  serviceValidator,
  upsertService,
} from "~/modules/parts";
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

  const { serviceId } = params;
  if (!serviceId) throw new Error("Could not find serviceId");

  const formData = await request.formData();
  const validation = await validator(serviceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePart = await upsertService(client, {
    ...validation.data,
    id: serviceId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updatePart.error) {
    throw redirect(
      path.to.service(serviceId),
      await flash(request, error(updatePart.error, "Failed to update part"))
    );
  }

  throw redirect(
    path.to.service(serviceId),
    await flash(request, success("Updated part"))
  );
}

export default function ServiceDetailsRoute() {
  const { serviceId } = useParams();
  if (!serviceId) throw new Error("Could not find serviceId");
  const routeData = useRouteData<{ service: Service }>(
    path.to.service(serviceId)
  );
  if (!routeData) throw new Error("Could not find part data");

  const itemInitialValues = {
    id: routeData.service?.itemId ?? "",
    readableId: routeData.service?.id ?? "",
    name: routeData.service?.name ?? "",
    description: routeData.service?.description ?? "",
    partGroupId: routeData.service?.partGroupId ?? "",
    active: routeData.service?.active ?? true,
    blocked: routeData.service?.blocked ?? false,
  };

  const serviceInitialValues = {
    id: routeData.service?.id!,
    name: routeData.service?.name ?? "",
    description: routeData.service?.description ?? undefined,
    serviceType: routeData.service?.serviceType ?? "Internal",
    partGroupId: routeData.service?.partGroupId ?? undefined,
    active: routeData.service?.active ?? true,
    blocked: routeData.service?.blocked ?? false,
    ...getCustomFields(routeData.service?.customFields),
  };

  return (
    <VStack spacing={4}>
      <ItemForm
        key={itemInitialValues.id}
        initialValues={itemInitialValues}
        type="service"
      />
      <ServiceForm
        key={serviceInitialValues.id}
        initialValues={serviceInitialValues}
      />
    </VStack>
  );
}
