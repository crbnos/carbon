// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Submit, ValidatedForm, validator } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Label,
  ScrollArea,
  toast
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { Users } from "~/components/Form";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import {
  maintenanceDispatchNotificationValidator,
  suggestionNotificationValidator
} from "~/modules/settings/settings.models";
import {
  getCompany,
  getCompanySettings
} from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Resources`,
  to: path.to.resourcesSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [company, companySettings] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId)
  ]);

  if (!company.data)
    throw redirect(
      path.to.settings,
      await flash(request, error(company.error, "Failed to get company"))
    );

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );

  return { company: company.data, companySettings: companySettings.data };
}

// One form per card, told apart by its intent: each becomes the fields of
// `settings.resources.update` it saves.
const resourcesSettingsForm = z.discriminatedUnion("intent", [
  suggestionNotificationValidator
    .extend({ intent: z.literal("suggestions") })
    .transform(({ suggestionNotificationGroup }) => ({
      suggestionNotificationGroup: suggestionNotificationGroup ?? []
    })),
  maintenanceDispatchNotificationValidator
    .extend({ intent: z.literal("maintenanceDispatchNotifications") })
    .transform((form) => ({
      maintenanceDispatchNotificationGroup:
        form.maintenanceDispatchNotificationGroup ?? [],
      qualityDispatchNotificationGroup:
        form.qualityDispatchNotificationGroup ?? [],
      operationsDispatchNotificationGroup:
        form.operationsDispatchNotificationGroup ?? [],
      otherDispatchNotificationGroup: form.otherDispatchNotificationGroup ?? []
    }))
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(resourcesSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updateResourcesSettings(input.data);
}

export default function ResourcesSettingsRoute() {
  const { t } = useLingui();
  const { company, companySettings } = useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      toast.success(
        data.suggestionNotificationGroup
          ? t`Suggestion notification settings updated`
          : t`Maintenance dispatch notification settings updated`
      );
    }
  });

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Resources</Trans>
        </SettingsPageHeading>

        <SettingsSectionHeader>
          <Trans>Notifications</Trans>
        </SettingsSectionHeader>

        <Card>
          <ValidatedForm
            method="post"
            validator={maintenanceDispatchNotificationValidator}
            defaultValues={{
              maintenanceDispatchNotificationGroup:
                (companySettings as any).maintenanceDispatchNotificationGroup ??
                [],
              qualityDispatchNotificationGroup:
                (companySettings as any).qualityDispatchNotificationGroup ?? [],
              operationsDispatchNotificationGroup:
                (companySettings as any).operationsDispatchNotificationGroup ??
                [],
              otherDispatchNotificationGroup:
                (companySettings as any).otherDispatchNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <input
              type="hidden"
              name="intent"
              value="maintenanceDispatchNotifications"
            />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Maintenance Dispatch Notifications</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Configure notifications for when maintenance dispatches are
                  created from the shop floor. Notifications are routed based on
                  the failure mode type.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Maintenance Type</Trans>
                  </Label>
                  <Users
                    name="maintenanceDispatchNotificationGroup"
                    label={t`Who should receive notifications for maintenance-related dispatches?`}
                    type="employee"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Quality Type</Trans>
                  </Label>
                  <Users
                    name="qualityDispatchNotificationGroup"
                    label={t`Who should receive notifications for quality-related dispatches?`}
                    type="employee"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Operations Type</Trans>
                  </Label>
                  <Users
                    name="operationsDispatchNotificationGroup"
                    label={t`Who should receive notifications for operations-related dispatches?`}
                    type="employee"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Other Type</Trans>
                  </Label>
                  <Users
                    name="otherDispatchNotificationGroup"
                    label={t`Who should receive notifications for other dispatches?`}
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") ===
                    "maintenanceDispatchNotifications"
                }
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <Card>
          <ValidatedForm
            method="post"
            validator={suggestionNotificationValidator}
            defaultValues={{
              suggestionNotificationGroup:
                company.suggestionNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="suggestions" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Suggestion Notifications</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Configure notifications for when new suggestions are
                  submitted.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Suggestion Notifications</Trans>
                  </Label>
                  <Users
                    name="suggestionNotificationGroup"
                    label={t`Who should receive notifications when a new suggestion is submitted?`}
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "suggestions"
                }
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </SettingsPage>
    </ScrollArea>
  );
}
