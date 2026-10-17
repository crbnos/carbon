// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { taxAuthorityValidator } from "~/modules/accounting/accounting.models";
import { TaxAuthorityForm } from "~/modules/accounting/ui/Tax";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(taxAuthorityValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...taxAuthority } = input.data;
  const api = await carbon(args.request);
  const result = await api.accounting.createTaxAuthority({
    ...taxAuthority,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // The modal form reads the result and closes itself.
  if (input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(
    `${path.to.taxAuthorities}?${getParams(args.request)}`,
    { message: "Tax authority created" }
  );
}

export default function NewTaxAuthorityRoute() {
  const closeRoute = useCloseRoute();
  const initialValues = {
    name: "",
    supplierId: ""
  };

  return (
    <TaxAuthorityForm
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
