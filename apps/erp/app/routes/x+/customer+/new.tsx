// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useUser } from "~/hooks";
import { customerValidator, upsertCustomer } from "~/modules/sales";
import { CustomerForm } from "~/modules/sales/ui/Customer";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Customers`,
  to: path.to.customers,
  module: "sales"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(customerValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const createCustomer = await upsertCustomer(client, {
    ...rest,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId
  });
  if (createCustomer.error) {
    return modal
      ? data(
          createCustomer,
          await flash(
            request,
            error(createCustomer.error, "Failed to insert customer")
          )
        )
      : redirect(
          path.to.customers,
          await flash(
            request,
            error(createCustomer.error, "Failed to insert customer")
          )
        );
  }

  const customerId = createCustomer.data?.id;

  return modal ? createCustomer : redirect(path.to.customer(customerId));
}

export default function CustomersNewRoute() {
  const { company } = useUser();

  const initialValues = {
    name: "",
    currencyCode: company?.baseCurrencyCode ?? undefined,
    phone: "",
    fax: "",
    website: "",
    taxPercent: 0
  };

  return (
    <NewRecordPage className="max-md:p-0">
      <CustomerForm initialValues={initialValues} />
    </NewRecordPage>
  );
}
