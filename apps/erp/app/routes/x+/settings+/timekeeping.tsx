// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Number, Select, Submit, TextArea } from "~/components/Form";
import {
  getCompanySettings,
  timekeepingControlsModes,
  timekeepingSettingsValidator,
  timesheetTimecardChecks,
  updateTimekeepingSettings
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings-timekeeping");

export const handle: Handle = {
  breadcrumb: msg`Timekeeping`,
  to: path.to.timekeepingSettings
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

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const validation = await validator(timekeepingSettingsValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  // DCAA mode needs a cost objective on every Released project, so each
  // charge lands in a known pool. Checked only when the mode turns on.
  if (validation.data.timekeepingControls === "DCAA") {
    const current = await getCompanySettings(client, companyId);
    if (current.data?.timekeepingControls !== "DCAA") {
      const missing = await client
        .from("project")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .eq("projectType", "Standard")
        .eq("status", "Released")
        .is("costObjective", null);
      if (missing.error) {
        logger.error("Failed to count projects with no cost objective", {
          companyId,
          error: missing.error
        });
        return {
          success: false,
          message: "Failed to check the projects' cost objectives"
        };
      }
      const count = missing.count ?? 0;
      if (count > 0) {
        return {
          success: false,
          message: `Set a cost objective on ${count} ${
            count === 1 ? "project" : "projects"
          } first`
        };
      }
    }
  }

  const update = await updateTimekeepingSettings(
    client,
    companyId,
    validation.data
  );
  if (update.error) {
    logger.error("Failed to update timekeeping settings", {
      companyId,
      error: update.error
    });
    return { success: false, message: "Failed to save the settings" };
  }
  return { success: true, message: "Timekeeping settings updated" };
}

export default function TimekeepingSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;
    if (fetcher.data.success) {
      toast.success(fetcher.data.message);
    } else {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

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

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Timekeeping</Trans>
        </Heading>

        <Card>
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
          >
            <CardHeader>
              <CardTitle>
                <Trans>Timekeeping Controls</Trans>
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
                  options={timekeepingControlsModes.map((mode) => ({
                    value: mode,
                    label: controlsLabels[mode]
                  }))}
                  helperText={t`DCAA requires daily entry, a reason for each change, certification at submit, and charging only by project members.`}
                />
                <Number
                  name="timesheetEntryWindowDays"
                  label={t`Entry window (days)`}
                  minValue={0}
                  helperText={t`In DCAA mode, an entry older than this needs a late reason.`}
                />
                <Select
                  name="timesheetTimecardCheck"
                  label={t`Timecard check`}
                  options={timesheetTimecardChecks.map((check) => ({
                    value: check,
                    label: timecardCheckLabels[check]
                  }))}
                  helperText={t`In DCAA mode, compares a submitted week with the employee's timecards.`}
                />
                <TextArea
                  name="certificationTextExempt"
                  label={t`Certification text, exempt staff`}
                />
                <TextArea
                  name="certificationTextNonExempt"
                  label={t`Certification text, non-exempt staff`}
                />
                <Number
                  name="standardWeeklyHours"
                  label={t`Standard weekly hours`}
                  minValue={0}
                  helperText={t`The hours an exempt employee's week is diluted to in DCAA mode.`}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit isDisabled={fetcher.state !== "idle"}>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
