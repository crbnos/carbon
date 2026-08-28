import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getWarrantyRegistration,
  upsertWarrantyRegistration,
  warrantyRegistrationValidator
} from "~/modules/sales";
import WarrantyRegistrationForm from "~/modules/sales/ui/Warranties/WarrantyRegistrationForm";
import { setCustomFields } from "~/utils/form";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Warranties`, to: path.to.warrantyRegistrations },
    (data) => data?.registration?.warrantyRegistrationId
  ),
  module: "sales"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const registration = await getWarrantyRegistration(client, id, companyId);
  if (registration.error) {
    throw redirect(
      path.to.warrantyRegistrations,
      await flash(
        request,
        error(registration.error, "Failed to load the warranty registration")
      )
    );
  }

  return { registration: registration.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(warrantyRegistrationValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  // biome-ignore lint/correctness/noUnusedVariables: id comes from the route
  const { id: _id, ...d } = validation.data;

  const update = await upsertWarrantyRegistration(client, {
    ...d,
    id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (update.error) {
    throw redirect(
      path.to.warrantyRegistration(id),
      await flash(
        request,
        error(update.error, "Failed to update the warranty registration")
      )
    );
  }

  throw redirect(
    path.to.warrantyRegistration(id),
    await flash(request, success("Warranty updated"))
  );
}

export default function WarrantyRegistrationRoute() {
  const { registration } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={4} className="w-full p-4">
      <WarrantyRegistrationForm registration={registration} />
    </VStack>
  );
}
