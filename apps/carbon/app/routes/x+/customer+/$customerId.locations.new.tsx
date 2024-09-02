import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate, useParams } from "@remix-run/react";
import {
  CustomerLocationForm,
  customerLocationValidator,
  insertCustomerLocation,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
