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
  taxAuthorityValidator,
  upsertTaxAuthority
} from "~/modules/accounting";
import { TaxAuthorityForm } from "~/modules/accounting/ui/Tax";
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

  const validation = await validator(taxAuthorityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...rest } = validation.data;

  const insertTaxAuthority = await upsertTaxAuthority(client, {
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertTaxAuthority.error) {
    return data(
      {},
      await flash(
        request,
        error(insertTaxAuthority.error, "Failed to insert tax authority")
      )
    );
  }

  return modal
    ? data(insertTaxAuthority, { status: 201 })
    : redirect(
        `${path.to.taxAuthorities}?${getParams(request)}`,
        await flash(request, success("Tax authority created"))
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
