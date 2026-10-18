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
import { taxAuthorityValidator } from "~/modules/accounting/accounting.models";
import { getTaxAuthority } from "~/modules/accounting/accounting.service";
import { TaxAuthorityForm } from "~/modules/accounting/ui/Tax";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { taxAuthorityId } = params;
  if (!taxAuthorityId) throw notFound("taxAuthorityId not found");

  const taxAuthority = await getTaxAuthority(client, taxAuthorityId);

  return {
    taxAuthority: taxAuthority?.data ?? null
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(taxAuthorityValidator).request(args, {
    params: ["taxAuthorityId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.updateTaxAuthority({
    ...input.data,
    id: input.params.taxAuthorityId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(
    `${path.to.taxAuthorities}?${getParams(args.request)}`,
    { message: "Updated tax authority" }
  );
}

export default function EditTaxAuthorityRoute() {
  const { taxAuthority } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: taxAuthority?.id ?? undefined,
    name: taxAuthority?.name ?? "",
    supplierId: taxAuthority?.supplierId ?? "",
    ...getCustomFields(taxAuthority?.customFields)
  };

  return (
    <TaxAuthorityForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
