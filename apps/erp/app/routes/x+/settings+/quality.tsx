// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Hidden,
  Input,
  Select,
  Submit,
  ValidatedForm,
  validator
} from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  Label,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { Users } from "~/components/Form";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import { useSavedToggle } from "~/hooks/useSavedToggle";
import { settingsToggle } from "~/modules/settings/settings.models";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Quality`,
  to: path.to.qualitySettings
};

const gaugeCalibrationValidator = z.object({
  intent: z.literal("gaugeCalibration"),
  gaugeCalibrationExpiredNotificationGroup: z.array(z.string()).optional()
});

const dashboardValidator = z.object({
  intent: z.literal("dashboard"),
  qualityIssueTarget: z.coerce.number().int().min(0)
});

const samplingStandardValidator = z.object({
  intent: z.literal("samplingStandard"),
  samplingStandard: z.enum(["ANSI_Z1_4", "ISO_2859_1"])
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings(client, companyId);

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return { companySettings: companySettings.data };
}

// One form per card, told apart by its intent: each becomes the fields of
// `settings.quality.update` it saves (the operation drops `intent`).
const qualitySettingsForm = z.discriminatedUnion("intent", [
  settingsToggle("enforceInspectionFourEyes", "enforceInspectionFourEyes"),
  samplingStandardValidator,
  dashboardValidator,
  gaugeCalibrationValidator.transform((form) => ({
    gaugeCalibrationExpiredNotificationGroup:
      form.gaugeCalibrationExpiredNotificationGroup ?? []
  }))
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(qualitySettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updateQualitySettings(input.data);
}

export default function QualitySettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.samplingStandard) toast.success(t`Sampling standard updated`);
      else if (data.qualityIssueTarget !== undefined)
        toast.success(t`Dashboard settings updated`);
      else toast.success(t`Gauge calibration notification settings updated`);
    }
  });
  const toggleFetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (data?.enforceInspectionFourEyes === undefined) return;
      toast.success(
        data.enforceInspectionFourEyes
          ? t`Four-eyes enforcement enabled`
          : t`Four-eyes enforcement disabled`
      );
    }
  });

  const fourEyesEnabled = useSavedToggle(
    toggleFetcher,
    "enforceInspectionFourEyes",
    (companySettings as { enforceInspectionFourEyes?: boolean })
      .enforceInspectionFourEyes ?? false
  );

  const handleFourEyesToggle = useCallback(
    (checked: boolean) => {
      toggleFetcher.submit(
        {
          intent: "enforceInspectionFourEyes",
          enabled: checked.toString()
        },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Quality</Trans>
        </SettingsPageHeading>

        <SettingsSectionHeader>
          <Trans>Notifications</Trans>
        </SettingsSectionHeader>

        <Card>
          <ValidatedForm
            method="post"
            validator={gaugeCalibrationValidator}
            defaultValues={{
              intent: "gaugeCalibration" as const,
              gaugeCalibrationExpiredNotificationGroup:
                companySettings.gaugeCalibrationExpiredNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <Hidden name="intent" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Gauge Calibration Notifications</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Configure notifications for when gauges go out of calibration.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Calibration Expiration Notifications</Trans>
                  </Label>
                  <Users
                    name="gaugeCalibrationExpiredNotificationGroup"
                    label={t`Who should receive notifications when a gauge goes out of calibration?`}
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        <SettingsSectionHeader>
          <Trans>Dashboard</Trans>
        </SettingsSectionHeader>

        <Card>
          <ValidatedForm
            method="post"
            validator={dashboardValidator}
            defaultValues={{
              intent: "dashboard" as const,
              qualityIssueTarget: companySettings.qualityIssueTarget ?? 20
            }}
            fetcher={fetcher}
          >
            <Hidden name="intent" />
            <CardHeader>
              <CardTitle>
                <Trans>Dashboard</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>Configure defaults for the quality dashboard.</Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="qualityIssueTarget">
                    <Trans>Issue Target</Trans>
                  </Label>
                  <Input name="qualityIssueTarget" type="number" min={0} />
                  <p className="text-xs text-muted-foreground">
                    <Trans>
                      Target number of open issues shown as a reference line on
                      the Issue Trend chart.
                    </Trans>
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        <SettingsSectionHeader>
          <Trans>Inspections</Trans>
        </SettingsSectionHeader>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Inspections: Require Different Inspector</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Warn when the person inspecting an inbound item is the same
                person who received it.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {fourEyesEnabled ? (
                    <Trans>A different inspector is required</Trans>
                  ) : (
                    <Trans>The same person may inspect</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {fourEyesEnabled ? (
                    <Trans>
                      Inspecting an item you received shows a warning.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to warn when the inspector also received the item.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={fourEyesEnabled}
                onCheckedChange={handleFourEyesToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>
        <Card>
          <ValidatedForm
            method="post"
            validator={samplingStandardValidator}
            defaultValues={{
              intent: "samplingStandard" as const,
              samplingStandard:
                ((companySettings as any).samplingStandard as
                  | "ANSI_Z1_4"
                  | "ISO_2859_1") ?? "ANSI_Z1_4"
            }}
            fetcher={fetcher}
          >
            <Hidden name="intent" />
            <CardHeader>
              <CardTitle>
                <Trans>Sampling Standard</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Attribute sampling standard used to compute lot sample sizes
                  and accept/reject numbers on inbound inspections.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 max-w-[400px]">
                <Label htmlFor="samplingStandard">
                  <Trans>Standard</Trans>
                </Label>
                <SamplingStandardSelect
                  value={
                    ((companySettings as any).samplingStandard as
                      | "ANSI_Z1_4"
                      | "ISO_2859_1") ?? "ANSI_Z1_4"
                  }
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
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

function SamplingStandardSelect({
  value
}: {
  value: "ANSI_Z1_4" | "ISO_2859_1";
}) {
  return (
    <Select
      name="samplingStandard"
      options={[
        { value: "ANSI_Z1_4", label: "ANSI/ASQ Z1.4" },
        { value: "ISO_2859_1", label: "ISO 2859-1" }
      ]}
      value={value}
    />
  );
}
