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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Label,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { Users } from "~/components/Form";
import { getCompanySettings } from "~/modules/settings";
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

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "enforceInspectionFourEyes") {
    const enabled = formData.get("enabled") === "true";
    const update = await client
      .from("companySettings")
      .update({ enforceInspectionFourEyes: enabled })
      .eq("id", companyId);

    if (update.error) return { success: false, message: update.error.message };

    return {
      success: true,
      message: `Four-eyes enforcement ${enabled ? "enabled" : "disabled"}`
    };
  }

  if (intent === "samplingStandard") {
    const validation = await validator(samplingStandardValidator).validate(
      formData
    );
    if (validation.error) {
      return { success: false, message: "Invalid form data" };
    }
    const update = await client
      .from("companySettings")
      // @ts-ignore - samplingStandard column added in migration 20260419100000
      .update({ samplingStandard: validation.data.samplingStandard })
      .eq("id", companyId);
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Sampling standard updated" };
  }

  if (intent === "dashboard") {
    const validation = await validator(dashboardValidator).validate(formData);
    if (validation.error) {
      return { success: false, message: "Invalid form data" };
    }

    const update = await client
      .from("companySettings")
      .update({ qualityIssueTarget: validation.data.qualityIssueTarget })
      .eq("id", companyId);

    if (update.error) return { success: false, message: update.error.message };

    return { success: true, message: "Dashboard settings updated" };
  }

  const validation = await validator(gaugeCalibrationValidator).validate(
    formData
  );

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const update = await client
    .from("companySettings")
    .update({
      gaugeCalibrationExpiredNotificationGroup:
        validation.data.gaugeCalibrationExpiredNotificationGroup ?? []
    })
    .eq("id", companyId);

  if (update.error) return { success: false, message: update.error.message };

  return {
    success: true,
    message: "Gauge calibration notification settings updated"
  };
}

export default function QualitySettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const toggleFetcher = useFetcher<typeof action>();

  const [fourEyesEnabled, setFourEyesEnabled] = useState(
    (companySettings as { enforceInspectionFourEyes?: boolean })
      .enforceInspectionFourEyes ?? false
  );

  const handleFourEyesToggle = useCallback(
    (checked: boolean) => {
      setFourEyesEnabled(checked);
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

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  useEffect(() => {
    if (toggleFetcher.data?.success === true && toggleFetcher.data?.message) {
      toast.success(toggleFetcher.data.message);
    }
    if (toggleFetcher.data?.success === false && toggleFetcher.data?.message) {
      toast.error(toggleFetcher.data.message);
    }
  }, [toggleFetcher.data?.message, toggleFetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Quality</Trans>
        </Heading>

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
        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>
                  <Trans>Inspections: Require Different Inspector</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Warn when the person inspecting an inbound item is the same
                    person who received it.
                  </Trans>
                </CardDescription>
              </div>
              <Switch
                checked={fourEyesEnabled}
                onCheckedChange={handleFourEyesToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardHeader>
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
      </VStack>
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
