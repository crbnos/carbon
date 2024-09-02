import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import {
  SupplierContactForm,
  getSupplierContact,
  supplierContactValidator,
  updateSupplierContact,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, badRequest, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { supplierId, supplierContactId } = params;
  if (!supplierId) throw notFound("supplierId not found");
  if (!supplierContactId) throw notFound("supplierContactId not found");

  const contact = await getSupplierContact(client, supplierContactId);
  if (contact.error) {
    throw redirect(
      path.to.supplierContacts(supplierId),
      await flash(
        request,
        error(contact.error, "Failed to get supplier contact")
      )
    );
  }

  return json({
    contact: contact.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "purchasing",
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

  const update = await updateSupplierContact(client, {
    contactId,
    contact,
    supplierLocationId,
    customFields: setCustomFields(formData),
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
    ...getCustomFields(contact?.customFields),
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
