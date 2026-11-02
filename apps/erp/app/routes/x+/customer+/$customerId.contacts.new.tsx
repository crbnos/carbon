// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data, useNavigate, useParams } from "react-router";
import { customerContactValidator } from "~/modules/sales/sales.models";
import { insertCustomerContact } from "~/modules/sales/sales.service";
import { CustomerContactForm } from "~/modules/sales/ui/Customer";
import { requireCompanyRecord } from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    create: "sales"
  });

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

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, contactId, customerLocationId, ...contact } = validation.data;

  // The contact is written through the service role: the customer in the URL
  // (and the location on the form) must belong to this company.
  await Promise.all([
    requireCompanyRecord(client, "customer", companyId, { id: customerId }),
    customerLocationId
      ? requireCompanyRecord(client, "customerLocation", companyId, {
          id: customerLocationId,
          customerId
        })
      : null
  ]);

  const createCustomerContact = await insertCustomerContact(
    getDatabaseClient(),
    {
      customerId,
      companyId,
      contact,
      customerLocationId,
      customFields: setCustomFields(formData)
    }
  );
  if (createCustomerContact.error) {
    return modal
      ? data(
          error(
            createCustomerContact.error,
            "Failed to create customer contact"
          ),
          {
            status: 400
          }
        )
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
    ? data(createCustomerContact, { status: 201 })
    : redirect(
        path.to.customerContacts(customerId),
        await flash(request, success("Customer contact created"))
      );
}

export default function CustomerContactsNewRoute() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const initialValues = {
    firstName: "",
    lastName: "",
    email: ""
  };

  return (
    <CustomerContactForm
      customerId={customerId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.customerContacts(customerId))}
    />
  );
}
