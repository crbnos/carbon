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
import { taxCodeValidator } from "~/modules/accounting/accounting.models";
import {
  getTaxAuthoritiesList,
  getTaxCode
} from "~/modules/accounting/accounting.service";
import { TaxCodeForm } from "~/modules/accounting/ui/Tax";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { taxCodeId } = params;
  if (!taxCodeId) throw notFound("taxCodeId not found");

  const [taxCode, taxAuthorities] = await Promise.all([
    getTaxCode(client, taxCodeId),
    getTaxAuthoritiesList(client, companyId)
  ]);

  return {
    taxCode: taxCode?.data ?? null,
    taxAuthorities: taxAuthorities.data ?? []
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(taxCodeValidator).request(args, {
    params: ["taxCodeId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.updateTaxCode({
    ...input.data,
    id: input.params.taxCodeId
  });
  return respond(args.request, result).redirect(
    `${path.to.taxCodes}?${getParams(args.request)}`,
    { message: "Updated tax code" }
  );
}

export default function EditTaxCodeRoute() {
  const { taxCode, taxAuthorities } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: taxCode?.id ?? undefined,
    name: taxCode?.name ?? "",
    description: taxCode?.description ?? undefined,
    calculationType: taxCode?.calculationType ?? ("Normal" as const),
    reportingCategory: taxCode?.reportingCategory ?? ("Standard" as const),
    taxesShipping: taxCode?.taxesShipping ?? false,
    invoiceMessage: taxCode?.invoiceMessage ?? undefined,
    countryCode: taxCode?.countryCode ?? undefined,
    state: taxCode?.state ?? undefined,
    active: taxCode?.active ?? true,
    components: [...(taxCode?.taxCodeComponent ?? [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map((c) => ({
        id: c.id,
        name: c.name,
        taxAuthorityId: c.taxAuthorityId ?? undefined,
        taxPercent: c.taxPercent,
        recoverablePercent: c.recoverablePercent,
        sequence: c.sequence,
        isCompound: c.isCompound,
        taxReceivedAccountId: c.taxReceivedAccountId ?? undefined,
        taxPaidAccountId: c.taxPaidAccountId ?? undefined,
        effectiveDate: c.effectiveDate ?? undefined,
        expirationDate: c.expirationDate ?? undefined
      }))
  };

  return (
    <TaxCodeForm
      key={initialValues.id}
      initialValues={initialValues}
      taxAuthorities={taxAuthorities}
      onClose={() => closeRoute()}
    />
  );
}
