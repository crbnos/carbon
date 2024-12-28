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
  customerContactValidator,
  insertCustomerContact,
} from "~/modules/sales";
import { CustomerContactForm } from "~/modules/sales/ui/Customer";
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
    let errorMessage = "Failed to create customer contact";
    if (createCustomerContact.error.message?.includes("duplicate key value")) {
      const contact = await client
        .from("contact")
        .select("id")
        .eq("email", validation.data.email)
        .eq("companyId", companyId)
        .single();
      if (contact.data) {
        const customerContact = await client
          .from("customerContact")
          .select("customerId")
          .eq("contactId", contact.data.id)
          .single();
        if (customerContact.data) {
          const customer = await client
            .from("customer")
            .select("name")
            .eq("id", customerContact.data.customerId)
            .single();
          errorMessage = `Contact ${validation.data.email} already exists for ${customer.data?.name}`;
        } else {
          const supplierContact = await client
            .from("supplierContact")
            .select("supplierId")
            .eq("contactId", contact.data.id)
            .single();
          if (supplierContact.data) {
            const supplier = await client
              .from("supplier")
              .select("name")
              .eq("id", supplierContact.data.supplierId)
              .single();
            errorMessage = `Contact ${validation.data.email} already exists for ${supplier.data?.name}`;
          }
        }
      }
    }

    return modal
      ? json(createCustomerContact)
      : redirect(
          path.to.customerContacts(customerId),
          await flash(request, error(createCustomerContact.error, errorMessage))
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
