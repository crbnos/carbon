// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { taxCodeValidator } from "~/modules/accounting/accounting.models";
import { getTaxAuthoritiesList } from "~/modules/accounting/accounting.service";
import { TaxCodeForm } from "~/modules/accounting/ui/Tax";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "accounting"
  });

  const taxAuthorities = await getTaxAuthoritiesList(client, companyId);

  return {
    taxAuthorities: taxAuthorities.data ?? []
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(taxCodeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...taxCode } = input.data;
  const api = await carbon(args.request);
  const result = await api.accounting.createTaxCode(taxCode);
  return respond(args.request, result).redirect(
    `${path.to.taxCodes}?${getParams(args.request)}`,
    { message: "Tax code created" }
  );
}

export default function NewTaxCodeRoute() {
  const { taxAuthorities } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const initialValues = {
    name: "",
    calculationType: "Normal" as const,
    reportingCategory: "Standard" as const,
    taxesShipping: false,
    active: true,
    components: []
  };

  return (
    <TaxCodeForm
      initialValues={initialValues}
      taxAuthorities={taxAuthorities}
      onClose={() => closeRoute()}
    />
  );
}
