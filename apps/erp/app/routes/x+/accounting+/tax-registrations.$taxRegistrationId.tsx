// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { taxRegistrationValidator } from "~/modules/accounting/accounting.models";
import { getTaxRegistration } from "~/modules/accounting/accounting.service";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(taxRegistrationValidator).request(args, {
    params: ["taxRegistrationId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.updateTaxRegistration({
    ...input.data,
    id: input.params.taxRegistrationId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(
    `${path.to.taxRegistrations}?${getParams(args.request)}`,
    { message: "Updated tax registration" }
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
