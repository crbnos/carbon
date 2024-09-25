import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  CustomerLocationForm,
  customerLocationValidator,
  insertCustomerLocation,
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const { customerId } = params;
  if (!customerId) throw notFound("customerId not found");

  const validation = await validator(customerLocationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, addressId, name, ...address } = validation.data;

  const createCustomerLocation = await insertCustomerLocation(client, {
    customerId,
    companyId,
    name,
    address,
    customFields: setCustomFields(formData),
  });
  if (createCustomerLocation.error) {
    return modal
      ? json(createCustomerLocation)
      : redirect(
          path.to.customerLocations(customerId),
          await flash(
            request,
            error(
              createCustomerLocation.error,
              "Failed to create customer location"
            )
          )
        );
  }

  return modal
    ? json(createCustomerLocation, { status: 201 })
    : redirect(
        path.to.customerLocations(customerId),
        await flash(request, success("Customer location created"))
      );
}

export default function CustomerLocationsNewRoute() {
  const navigate = useNavigate();

  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const initialValues = {
    name: "",
  };

  return (
    <CustomerLocationForm
      initialValues={initialValues}
      customerId={customerId}
      onClose={() => navigate(path.to.customerLocations(customerId))}
    />
  );
}
