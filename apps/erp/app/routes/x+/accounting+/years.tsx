import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { ScrollArea, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  fiscalYearSettingsValidator,
  getFiscalYearSettings,
  updateFiscalYearSettings
} from "~/modules/accounting";
import { FiscalYearSettingsForm } from "~/modules/accounting/ui/FiscalYear";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Fiscal Years`,
  to: path.to.fiscalYears
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "accounting"
  });

  const settings = await getFiscalYearSettings();
  if (settings.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(settings.error, "Failed to get fiscal year settings")
      )
    );
  }

  return { settings: settings.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const validation = await validator(fiscalYearSettingsValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateFiscalYearSettings({
    ...validation.data,
    companyId,
    updatedBy: userId
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
    taxStartMonth: settings?.taxStartMonth || "January"
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <FiscalYearSettingsForm initialValues={initialValues} />
      </VStack>
    </ScrollArea>
  );
}
