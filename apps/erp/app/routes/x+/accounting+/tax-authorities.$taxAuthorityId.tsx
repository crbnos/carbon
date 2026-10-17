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
  getTaxAuthority,
  taxAuthorityValidator,
  upsertTaxAuthority
} from "~/modules/accounting";
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(taxAuthorityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateTaxAuthority = await upsertTaxAuthority(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateTaxAuthority.error) {
    return data(
      {},
      await flash(
        request,
        error(updateTaxAuthority.error, "Failed to update tax authority")
      )
    );
  }

  throw redirect(
    `${path.to.taxAuthorities}?${getParams(request)}`,
    await flash(request, success("Updated tax authority"))
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
