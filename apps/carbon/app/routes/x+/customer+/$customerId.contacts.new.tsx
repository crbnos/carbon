import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  notFound,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  CustomerContactForm,
  customerContactValidator,
  insertCustomerContact,
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { customerContactsQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    create: "sales",
  });

  // RLS doesn't work for selecting a contact with no customer
  const client = getCarbonServiceRole();

  const { customerId } = params;
  if (!customerId) throw notFound("customerId not found");

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(customerContactValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, contactId, customerLocationId, ...contact } = validation.data;

  const createCustomerContact = await insertCustomerContact(client, {
    customerId,
    companyId,
    contact,
    customerLocationId,
    customFields: setCustomFields(formData),
  });
  if (createCustomerContact.error) {
    return modal
      ? json(createCustomerContact)
      : redirect(
          path.to.customerContacts(customerId),
          await flash(
            request,
            error(
              createCustomerContact.error,
              "Failed to create customer contact"
            )
          )
        );
  }

  return modal
    ? json(createCustomerContact, { status: 201 })
    : redirect(
        path.to.customerContacts(customerId),
        await flash(request, success("Customer contact created"))
      );
}

export async function clientAction({
  serverAction,
  params,
}: ClientActionFunctionArgs) {
  const { customerId } = params;

  if (customerId) {
    window.clientCache?.setQueryData(
      customerContactsQuery(customerId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function CustomerContactsNewRoute() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const initialValues = {
    firstName: "",
    lastName: "",
    email: "",
  };

  return (
    <CustomerContactForm
      customerId={customerId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.customerContacts(customerId))}
    />
  );
}
