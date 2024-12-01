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
  SupplierContactForm,
  insertSupplierContact,
  supplierContactValidator,
} from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { supplierContactsQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    create: "purchasing",
  });

  // RLS doesn't work for selecting a contact with no supplier
  const client = getCarbonServiceRole();

  const { supplierId } = params;
  if (!supplierId) throw notFound("supplierId not found");

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(supplierContactValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, contactId, supplierLocationId, ...contact } = validation.data;

  const createSupplierContact = await insertSupplierContact(client, {
    supplierId,
    companyId,
    contact,
    supplierLocationId,
    customFields: setCustomFields(formData),
  });
  if (createSupplierContact.error) {
    return modal
      ? json(createSupplierContact)
      : redirect(
          path.to.supplierContacts(supplierId),
          await flash(
            request,
            error(
              createSupplierContact.error,
              "Failed to create supplier contact"
            )
          )
        );
  }

  return modal
    ? json(createSupplierContact)
    : redirect(
        path.to.supplierContacts(supplierId),
        await flash(request, success("Supplier contact created"))
      );
}

export async function clientAction({
  serverAction,
  params,
}: ClientActionFunctionArgs) {
  const { supplierId } = params;
  if (supplierId) {
    window.queryClient.setQueryData(
      supplierContactsQuery(supplierId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function SupplierContactsNewRoute() {
  const navigate = useNavigate();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const initialValues = {
    firstName: "",
    lastName: "",
    email: "",
  };

  return (
    <SupplierContactForm
      supplierId={supplierId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.supplierContacts(supplierId))}
    />
  );
}
