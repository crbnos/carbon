// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  taxRegistrationValidator,
  upsertTaxRegistration
} from "~/modules/accounting";
import { TaxRegistrationForm } from "~/modules/accounting/ui/Tax";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(taxRegistrationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...rest } = validation.data;

  const insertTaxRegistration = await upsertTaxRegistration(client, {
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertTaxRegistration.error) {
    return data(
      {},
      await flash(
        request,
        error(insertTaxRegistration.error, "Failed to insert tax registration")
      )
    );
  }

  return modal
    ? data(insertTaxRegistration, { status: 201 })
    : redirect(
        `${path.to.taxRegistrations}?${getParams(request)}`,
        await flash(request, success("Tax registration created"))
      );
}

export default function NewTaxRegistrationRoute() {
  const closeRoute = useCloseRoute();
  const initialValues = {
    countryCode: "",
    state: "",
    registrationNumber: "",
    effectiveDate: "",
    endDate: ""
  };

  return (
    <TaxRegistrationForm
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
