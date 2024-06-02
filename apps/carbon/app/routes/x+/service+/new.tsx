import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  ServiceForm,
  newServiceValidator,
  upsertService,
} from "~/modules/parts";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Services",
  to: path.to.services,
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const validation = await validator(newServiceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const createService = await upsertService(client, {
    ...validation.data,
    companyId,
    active: true,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (createService.error) {
    throw redirect(
      path.to.services,
      await flash(
        request,
        error(createService.error, "Failed to create service")
      )
    );
  }

  const serviceId = createService.data?.id;
  if (!serviceId) {
    throw redirect(
      path.to.services,
      await flash(
        request,
        error(createService.error, "Failed to create service")
      )
    );
  }

  throw redirect(path.to.service(serviceId));
}

export default function ServiceNewRoute() {
  const initialValues = {
    name: "",
    description: "",
    serviceType: "External" as "External",
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto">
      {/* @ts-ignore */}
      <ServiceForm initialValues={initialValues} />
    </div>
  );
}
