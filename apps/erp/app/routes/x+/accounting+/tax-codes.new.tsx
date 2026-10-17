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
import { data, useLoaderData } from "react-router";
import {
  getTaxAuthoritiesList,
  taxCodeValidator,
  upsertTaxCode
} from "~/modules/accounting";
import { TaxCodeForm } from "~/modules/accounting/ui/Tax";
import { getDatabaseClient } from "~/services/database.server";
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, companyGroupId, userId } = await requirePermissions(
    request,
    {
      create: "accounting"
    }
  );

  const formData = await request.formData();
  const validation = await validator(taxCodeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, components, ...taxCode } = validation.data;

  const insertTaxCode = await upsertTaxCode(getDatabaseClient(), {
    companyId,
    companyGroupId,
    userId,
    taxCode,
    components
  });

  if (insertTaxCode.error) {
    return data(
      {},
      await flash(
        request,
        error(insertTaxCode.error, "Failed to create tax code")
      )
    );
  }

  throw redirect(
    `${path.to.taxCodes}?${getParams(request)}`,
    await flash(request, success("Tax code created"))
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
