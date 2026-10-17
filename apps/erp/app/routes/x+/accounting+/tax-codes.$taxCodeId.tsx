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
  getTaxAuthoritiesList,
  getTaxCode,
  taxCodeValidator,
  upsertTaxCode
} from "~/modules/accounting";
import { TaxCodeForm } from "~/modules/accounting/ui/Tax";
import { getDatabaseClient } from "~/services/database.server";
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, companyGroupId, userId } = await requirePermissions(
    request,
    {
      update: "accounting"
    }
  );

  const formData = await request.formData();
  const validation = await validator(taxCodeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { components, ...taxCode } = validation.data;
  if (!taxCode.id) throw new Error("id not found");

  const updateTaxCode = await upsertTaxCode(getDatabaseClient(), {
    companyId,
    companyGroupId,
    userId,
    taxCode,
    components
  });

  if (updateTaxCode.error) {
    return data(
      {},
      await flash(
        request,
        error(updateTaxCode.error, "Failed to update tax code")
      )
    );
  }

  throw redirect(
    `${path.to.taxCodes}?${getParams(request)}`,
    await flash(request, success("Updated tax code"))
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
