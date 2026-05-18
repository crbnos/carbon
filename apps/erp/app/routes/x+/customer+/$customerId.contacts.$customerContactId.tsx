import {
  assertIsPost,
  badRequest,
  error,
  notFound,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import {
  customerContactValidator,
  getCustomerContact,
  updateCustomerContact
} from "~/modules/sales";
import { CustomerContactForm } from "~/modules/sales/ui/Customer";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { customerContactsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const { customerId, customerContactId } = params;
  if (!customerId) throw notFound("customerId not found");
  if (!customerContactId) throw notFound("customerContactId not found");

  const contact = await getCustomerContact(customerContactId);
  if (contact.error) {
    throw redirect(
      path.to.customerContacts(customerId),
      await flash(
        request,
        error(contact.error, "Failed to get customer contact")
      )
    );
  }

  return {
    contact: contact.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "sales"
  });

  const { customerId, customerContactId } = params;
  if (!customerId) throw notFound("customerId not found");
  if (!customerContactId) throw notFound("customerContactId not found");

  const formData = await request.formData();
  const validation = await validator(customerContactValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, contactId, customerLocationId, ...contact } = validation.data;

  if (id !== customerContactId)
    throw badRequest("customerContactId does not match id from form data");

  if (contactId === undefined)
    throw badRequest("contactId is undefined from form data");

  const update = await updateCustomerContact({
    contactId,
    contact,
    customerLocationId,
    customFields: setCustomFields(formData)
  });

  if (update.error) {
    throw redirect(
      path.to.customerContacts(customerId),
      await flash(
        request,
        error(update.error, "Failed to update customer contact")
      )
    );
  }

  throw redirect(
    path.to.customerContacts(customerId),
    await flash(request, success("Customer contact updated"))
  );
}

export async function clientAction({
  serverAction,
  params
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

export default function EditCustomerContactRoute() {
  const { contact } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const initialValues = {
    id: contact?.id ?? undefined,
    contactId: contact?.contact?.id ?? undefined,
    firstName: contact?.contact?.firstName ?? "",
    lastName: contact?.contact?.lastName ?? "",
    email: contact?.contact?.email ?? "",
    title: contact?.contact?.title ?? "",
    mobilePhone: contact?.contact?.mobilePhone ?? "",
    homePhone: contact?.contact?.homePhone ?? "",
    workPhone: contact?.contact?.workPhone ?? "",
    fax: contact?.contact?.fax ?? "",
    notes: contact?.contact?.notes ?? "",
    customerLocationId: contact?.customerLocationId ?? "",
    ...getCustomFields(contact?.customFields)
  };

  return (
    <CustomerContactForm
      key={initialValues.id}
      customerId={customerId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.customerContacts(customerId))}
    />
  );
}
