import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { isInternalEmail } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  CompanyForm,
  getSubsidiary,
  subsidiaryValidator,
  updateSubsidiary
} from "~/modules/settings";
import { invalidateCompanyTimeZone } from "~/modules/shared/timezone.server";
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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, email } = await requirePermissions(request, {
    update: "settings"
  });

  // Multi-company management is gated to internal (Carbon) users for now.
  if (!isInternalEmail(email)) {
    throw redirect(path.to.settings);
  }

  const { id } = params;
  if (!id) throw notFound("Subsidiary not found");

  const formData = await request.formData();
  const validation = await validator(subsidiaryValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await updateSubsidiary(client, id, {
    ...validation.data,
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.companies,
      await flash(request, error(result.error, "Failed to update subsidiary"))
    );
  }

  // company.timezone may have changed — drop the cached resolution.
  await invalidateCompanyTimeZone(id);

  throw redirect(
    path.to.companies,
    await flash(request, success("Updated subsidiary"))
  );
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
