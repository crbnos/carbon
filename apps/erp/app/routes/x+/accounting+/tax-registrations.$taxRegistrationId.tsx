// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  getTaxRegistration,
  taxRegistrationValidator,
  upsertTaxRegistration
} from "~/modules/accounting";
import { TaxRegistrationForm } from "~/modules/accounting/ui/Tax";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { taxRegistrationId } = params;
  if (!taxRegistrationId) throw notFound("taxRegistrationId not found");

  const taxRegistration = await getTaxRegistration(client, taxRegistrationId);

  return {
    taxRegistration: taxRegistration?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(taxRegistrationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateTaxRegistration = await upsertTaxRegistration(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateTaxRegistration.error) {
    return data(
      {},
      await flash(
        request,
        error(updateTaxRegistration.error, "Failed to update tax registration")
      )
    );
  }

  throw redirect(
    `${path.to.taxRegistrations}?${getParams(request)}`,
    await flash(request, success("Updated tax registration"))
  );
}

export default function EditTaxRegistrationRoute() {
  const { taxRegistration } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: taxRegistration?.id ?? undefined,
    countryCode: taxRegistration?.countryCode ?? "",
    state: taxRegistration?.state ?? "",
    registrationNumber: taxRegistration?.registrationNumber ?? "",
    effectiveDate: taxRegistration?.effectiveDate ?? "",
    endDate: taxRegistration?.endDate ?? "",
    ...getCustomFields(taxRegistration?.customFields)
  };

  return (
    <TaxRegistrationForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
