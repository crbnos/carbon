// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, ValidatedForm, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { serviceErrorMessage, useAction } from "@carbon/query";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ScrollArea,
  toast
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { Boolean, Number, Select, Submit, TextArea } from "~/components/Form";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import {
  settingsToggle,
  timeCardSettingsValidator,
  timekeepingControlsModes,
  timekeepingSettingsValidator,
  timesheetTimecardChecks
} from "~/modules/settings/settings.models";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings-time");

export const handle: Handle = {
  breadcrumb: msg`Time`,
  to: path.to.timeSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings(client, companyId);
  if (!companySettings.data) {
    logger.error("Failed to load company settings", {
      companyId,
      error: companySettings.error
    });
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  }
  return { companySettings: companySettings.data };
}

// Two forms, told apart by their intent: the Timecards switch saves on its
// own (it moved here from Settings → People), the controls form saves every
// timekeeping field at once.
const timeSettingsForm = z.discriminatedUnion("intent", [
  settingsToggle("timeCard", "timeCardEnabled"),
  timekeepingSettingsValidator
    .safeExtend({ intent: z.literal("timekeeping") })
    // An emptied certification text clears the stored one.
    .transform(({ intent: _, ...settings }) => ({
      ...settings,
      certificationTextExempt: settings.certificationTextExempt ?? null,
      certificationTextNonExempt: settings.certificationTextNonExempt ?? null
    }))
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(timeSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updateTimeSettings(input.data);
}

export default function TimeSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const fetcher = useAction<typeof action>({
    onSuccess: () => toast.success(t`Time settings updated`)
  });

  // The Timecards switch posts at once; a refused save puts it back.
  const [timeCardReset, setTimeCardReset] = useState(0);
  const timeCardFetcher = useAction<typeof action>({
    onSuccess: () => toast.success(t`Timecard settings updated`),
    onError: (result) => {
      toast.error(
        serviceErrorMessage(result) ?? t`Failed to update timecard settings`
      );
      setTimeCardReset((count) => count + 1);
    }
  });

  // The DCAA card follows the picker as it changes, before a save. Only the
  // user's pick is state; until they pick, the saved setting decides.
  const [controlsChoice, setControls] = useState<"Standard" | "DCAA" | null>(
    null
  );
  const isDcaa =
    (controlsChoice ?? companySettings.timekeepingControls) === "DCAA";

  const controlsLabels: Record<
    (typeof timekeepingControlsModes)[number],
    string
  > = {
    Standard: t`Standard`,
    DCAA: t`DCAA`
  };
  const timecardCheckLabels: Record<
    (typeof timesheetTimecardChecks)[number],
    string
  > = {
    Off: t`Off`,
    Warn: t`Warn`,
    Block: t`Block`
  };

  const save = (
    <CardFooter>
      <Submit isDisabled={fetcher.state !== "idle"}>
        <Trans>Save</Trans>
      </Submit>
    </CardFooter>
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Time</Trans>
        </SettingsPageHeading>

        {/* One form over both cards: the action saves every field at once.
            The DCAA card only hides under Standard, so its fields still
            post (D14). */}
        <ValidatedForm
          method="post"
          validator={timekeepingSettingsValidator}
          defaultValues={{
            timekeepingControls:
              companySettings.timekeepingControls ?? "Standard",
            timesheetEntryWindowDays:
              companySettings.timesheetEntryWindowDays ?? 1,
            timesheetTimecardCheck:
              (companySettings.timesheetTimecardCheck as
                | (typeof timesheetTimecardChecks)[number]
                | null) ?? "Warn",
            certificationTextExempt:
              companySettings.certificationTextExempt ?? "",
            certificationTextNonExempt:
              companySettings.certificationTextNonExempt ?? "",
            standardWeeklyHours: companySettings.standardWeeklyHours ?? 40
          }}
          fetcher={fetcher}
          className="flex w-full flex-col gap-4"
        >
          <Hidden name="intent" value="timekeeping" />
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Controls</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  How employees record time on projects. Standard keeps the
                  timesheet simple. DCAA adds the controls a government contract
                  audit checks.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <Select
                  name="timekeepingControls"
                  label={t`Controls`}
                  termId="timekeeping-controls"
                  options={timekeepingControlsModes.map((mode) => ({
                    value: mode,
                    label: controlsLabels[mode]
                  }))}
                  onChange={(option) =>
                    setControls(option?.value === "DCAA" ? "DCAA" : "Standard")
                  }
                  helperText={t`DCAA requires daily entry, a reason for each change, certification at submit, and charging only by project members.`}
                />
              </div>
            </CardContent>
            {!isDcaa && save}
          </Card>

          <Card className={isDcaa ? undefined : "hidden"}>
            <CardHeader>
              <CardTitle>
                <Trans>DCAA rules</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  The entry window, the timecard check, dilution and the
                  certification an employee signs at submit.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-8 max-w-[400px]">
                  <Number
                    name="timesheetEntryWindowDays"
                    label={t`Entry window (days)`}
                    minValue={0}
                    helperText={t`An entry older than this needs a late reason.`}
                  />
                  <Select
                    name="timesheetTimecardCheck"
                    label={t`Timecard check`}
                    options={timesheetTimecardChecks.map((check) => ({
                      value: check,
                      label: timecardCheckLabels[check]
                    }))}
                    helperText={t`Compares a submitted week with the employee's timecards.`}
                  />
                  <Number
                    name="standardWeeklyHours"
                    label={t`Standard weekly hours`}
                    termId="dilution"
                    minValue={0}
                    helperText={t`The hours an exempt employee's week is diluted to.`}
                  />
                </div>
                <div className="flex flex-col gap-8 max-w-[640px]">
                  <TextArea
                    name="certificationTextExempt"
                    label={t`Certification text, exempt staff`}
                  />
                  <TextArea
                    name="certificationTextNonExempt"
                    label={t`Certification text, non-exempt staff`}
                  />
                </div>
              </div>
            </CardContent>
            {isDcaa && save}
          </Card>
        </ValidatedForm>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trans>Timecards</Trans>
              <Badge variant="yellow">
                <Trans>Beta</Trans>
              </Badge>
            </CardTitle>
            <CardDescription>
              <Trans>Enable timecard tracking for work shifts.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ValidatedForm
              key={`${companySettings.timeCardEnabled}:${timeCardReset}`}
              validator={timeCardSettingsValidator}
              defaultValues={{
                timeCardEnabled: companySettings.timeCardEnabled ?? false
              }}
              className="max-w-[400px]"
            >
              <Boolean
                name="timeCardEnabled"
                label={t`Track work shifts`}
                description={
                  companySettings.timeCardEnabled
                    ? t`Work shift tracking is active.`
                    : t`Enable to start tracking work shifts.`
                }
                bordered
                isDisabled={timeCardFetcher.state !== "idle"}
                onChange={(checked) =>
                  timeCardFetcher.submit(
                    { intent: "timeCard", enabled: String(checked) },
                    { method: "POST" }
                  )
                }
              />
            </ValidatedForm>
          </CardContent>
        </Card>
      </SettingsPage>
    </ScrollArea>
  );
}
