import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Boolean,
  Number,
  Submit,
  ValidatedForm,
  validationError,
  validator
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getCompanyGroupIntercompanySettings,
  intercompanyMatchingSettingsValidator,
  updateCompanyGroupIntercompanySettings
} from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Group Settings`,
  to: path.to.companyGroupSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const settings = await getCompanyGroupIntercompanySettings(
    client,
    companyGroupId
  );

  return {
    settings: settings.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const validation = await validator(
    intercompanyMatchingSettingsValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateCompanyGroupIntercompanySettings(
    client,
    companyGroupId,
    {
      intercompanyMatchingTolerance:
        validation.data.intercompanyMatchingTolerance,
      intercompanyDocumentMirroring:
        validation.data.intercompanyDocumentMirroring,
      updatedBy: userId
    }
  );

  if (update.error) {
    throw redirect(
      path.to.companyGroupSettings,
      await flash(
        request,
        error(update.error, "Failed to update group settings")
      )
    );
  }

  throw redirect(
    path.to.companyGroupSettings,
    await flash(request, success("Group settings updated"))
  );
}

export default function CompanyGroupSettingsRoute() {
  const { t } = useLingui();
  const { settings } = useLoaderData<typeof loader>();

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Group Settings</Trans>
        </Heading>

        <Card>
          <ValidatedForm
            method="post"
            validator={intercompanyMatchingSettingsValidator}
            defaultValues={{
              intercompanyMatchingTolerance:
                settings?.intercompanyMatchingTolerance ?? 0,
              intercompanyDocumentMirroring:
                settings?.intercompanyDocumentMirroring ?? false
            }}
          >
            <CardHeader>
              <CardTitle>
                <Trans>Intercompany</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Configure intercompany matching tolerance and document
                  mirroring across the company group.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <Number
                  name="intercompanyMatchingTolerance"
                  label={t`Intercompany matching tolerance`}
                  minValue={0}
                />
                <Boolean
                  name="intercompanyDocumentMirroring"
                  label={t`Enable document mirroring`}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
