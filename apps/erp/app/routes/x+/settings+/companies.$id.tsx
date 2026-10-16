// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { isInternalEmail, redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { subsidiaryValidator } from "~/modules/settings/settings.models";
import { getSubsidiary } from "~/modules/settings/settings.service";
import { CompanyForm } from "~/modules/settings/ui";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, email } = await requirePermissions(request, {
    view: "settings"
  });

  // Multi-company management is gated to internal (Carbon) users for now.
  if (!isInternalEmail(email)) {
    throw redirect(path.to.settings);
  }

  const { id } = params;
  if (!id) throw notFound("Subsidiary not found");

  const subsidiary = await getSubsidiary(client, id);
  if (subsidiary.error) {
    throw redirect(
      path.to.companies,
      await flash(request, error(subsidiary.error, "Failed to load subsidiary"))
    );
  }

  return { subsidiary: subsidiary.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(subsidiaryValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.updateSubsidiaryDetails({
    ...input.data,
    id: input.params.id
  });
  return respond(args.request, result).redirect(path.to.companies, {
    message: "Updated subsidiary"
  });
}

export default function EditSubsidiaryRoute() {
  const { subsidiary } = useLoaderData<typeof loader>();

  const initialValues = {
    name: subsidiary.name ?? "",
    taxId: subsidiary.taxId ?? "",
    addressLine1: subsidiary.addressLine1 ?? "",
    addressLine2: subsidiary.addressLine2 ?? "",
    city: subsidiary.city ?? "",
    stateProvince: subsidiary.stateProvince ?? "",
    postalCode: subsidiary.postalCode ?? "",
    countryCode: subsidiary.countryCode ?? "",
    baseCurrencyCode: subsidiary.baseCurrencyCode ?? "",
    phone: subsidiary.phone ?? "",
    fax: subsidiary.fax ?? "",
    email: subsidiary.email ?? "",
    website: subsidiary.website ?? "",
    timezone: subsidiary.timezone ?? "UTC"
  };

  return <CompanyForm company={initialValues} />;
}
