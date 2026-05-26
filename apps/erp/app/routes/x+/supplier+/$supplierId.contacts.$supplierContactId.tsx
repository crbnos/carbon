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
import { supplierContactValidator } from "~/modules/purchasing";
import {
  getSupplierContact,
  updateSupplierContact
} from "~/modules/purchasing/purchasing.service.server";
import SupplierContactForm from "~/modules/purchasing/ui/Supplier/SupplierContactForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { supplierContactsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId, supplierContactId } = params;
  if (!supplierId) throw notFound("supplierId not found");
  if (!supplierContactId) throw notFound("supplierContactId not found");

  const contact = await getSupplierContact(supplierContactId);
  if (contact.error) {
    throw redirect(
      path.to.supplierContacts(supplierId),
      await flash(
        request,
        error(contact.error, "Failed to get supplier contact")
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
    update: "purchasing"
  });

  const { supplierId, supplierContactId } = params;
  if (!supplierId) throw notFound("supplierId not found");
  if (!supplierContactId) throw notFound("supplierContactId not found");

  const formData = await request.formData();
  const validation = await validator(supplierContactValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, contactId, supplierLocationId, ...contact } = validation.data;

  if (id !== supplierContactId)
    throw badRequest("supplierContactId does not match id from form data");

  if (contactId === undefined)
    throw badRequest("contactId is undefined from form data");

  const update = await updateSupplierContact({
    contactId,
    contact,
    supplierLocationId,
    customFields: setCustomFields(formData)
  });

  if (update.error) {
    throw redirect(
      path.to.supplierContacts(supplierId),
      await flash(
        request,
        error(update.error, "Failed to update supplier contact")
      )
    );
  }

  throw redirect(
    path.to.supplierContacts(supplierId),
    await flash(request, success("Supplier contact updated"))
  );
}

export async function clientAction({
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const { supplierId } = params;
  if (supplierId) {
    window.clientCache?.setQueryData(
      supplierContactsQuery(supplierId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function EditSupplierContactRoute() {
  const { contact } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

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
    supplierLocationId: contact?.supplierLocationId ?? "",
    notes: contact?.contact?.notes ?? "",
    ...getCustomFields(contact?.customFields)
  };

  return (
    <SupplierContactForm
      key={initialValues.id}
      supplierId={supplierId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.supplierContacts(supplierId))}
    />
  );
}
