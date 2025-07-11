import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { customerPortalValidator } from "~/modules/sales";
import CustomerPortalForm from "~/modules/sales/ui/CustomerPortals/CustomerPortalForm";
import { getCustomerPortal, upsertExternalLink } from "~/modules/shared";

import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const customerPortal = await getCustomerPortal(client, id);

  if (customerPortal.error) {
    throw redirect(
      path.to.customerPortals,
      await flash(
        request,
        error(customerPortal.error, "Failed to get customer portal")
      )
    );
  }

  return json({
    customerPortal: customerPortal.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(customerPortalValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, customerId } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCustomerPortal = await upsertExternalLink(client, {
    id,
    documentType: "Customer",
    documentId: customerId,
    customerId,
  });

  if (updateCustomerPortal.error) {
    return json(
      {},
      await flash(
        request,
        error(updateCustomerPortal.error, "Failed to update customer portal")
      )
    );
  }

  throw redirect(
    path.to.customerPortals,
    await flash(request, success("Updated customer portal"))
  );
}

export default function EditCustomerPortalRoute() {
  const { customerPortal } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: customerPortal.id ?? undefined,
    customerId: customerPortal.customerId ?? "",
  };

  return (
    <CustomerPortalForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
