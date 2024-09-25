import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  FiscalYearSettingsForm,
  fiscalYearSettingsValidator,
  getFiscalYearSettings,
  updateFiscalYearSettings,
} from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Fiscal Years",
  to: path.to.fiscalYears,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
  });

  const settings = await getFiscalYearSettings(client, companyId);
  if (settings.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(settings.error, "Failed to get fiscal year settings")
      )
    );
  }

  return json({ settings: settings.data });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting",
  });

  const validation = await validator(fiscalYearSettingsValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateFiscalYearSettings(client, {
    ...validation.data,
    companyId,
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.fiscalYears,
      await flash(
        request,
        error(update.error, "Failed to update fiscal year settings")
      )
    );
  }

  throw redirect(
    path.to.fiscalYears,
    await flash(request, success("Successfully updated fiscal year settings"))
  );
}

export default function FiscalYearSettingsRoute() {
  const { settings } = useLoaderData<typeof loader>();

  const initialValues = {
    startMonth: settings?.startMonth || "January",
    taxStartMonth: settings?.taxStartMonth || "January",
  };

  return (
    <VStack spacing={0} className="h-full p-4">
      <FiscalYearSettingsForm initialValues={initialValues} />
    </VStack>
  );
}
