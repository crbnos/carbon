import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useUser } from "~/hooks";
import { customerLocationValidator } from "~/modules/sales";
import { insertCustomerLocation } from "~/modules/sales/sales.service.server";
import { CustomerLocationForm } from "~/modules/sales/ui/Customer";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { customerLocationsQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    create: "sales"
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

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, addressId, name, ...address } = validation.data;

  const createCustomerLocation = await insertCustomerLocation({
    customerId,
    name,
    address,
    customFields: setCustomFields(formData)
  });
  if (createCustomerLocation.error) {
    return modal
      ? createCustomerLocation
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
    ? data(createCustomerLocation, { status: 201 })
    : redirect(
        path.to.customerLocations(customerId),
        await flash(request, success("Customer location created"))
      );
}

export async function clientAction({
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const { customerId } = params;
  if (customerId) {
    window.clientCache?.setQueryData(
      customerLocationsQuery(customerId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function CustomerLocationsNewRoute() {
  const navigate = useNavigate();
  const { company } = useUser();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const initialValues = {
    name: "",
    countryCode: company?.countryCode ?? ""
  };

  return (
    <CustomerLocationForm
      initialValues={initialValues}
      customerId={customerId}
      onClose={() => navigate(path.to.customerLocations(customerId))}
    />
  );
}
