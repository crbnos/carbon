// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  toast
} from "@carbon/react";
import { formatTimeOfDay } from "@carbon/utils";
import { parseTime, Time } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { Hidden, Select, Submit } from "~/components/Form";
import { useCompanyTimeZone } from "~/hooks";
import { mrpScheduleTypes, mrpScheduleValidator } from "~/modules/settings";

type MrpScheduleType = (typeof mrpScheduleTypes)[number];

// One settings card = one saved concern (archetype F): when MRP runs on its
// own. Every 3 hours, or once a day at `companySettings.mrpRunTime`.

export function MrpScheduleCard({
  mrpRunTime
}: {
  /** The stored "HH:MM:SS", or null for the 3-hourly default. */
  mrpRunTime: string | null;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const companyTimeZone = useCompanyTimeZone();
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const storedTime = mrpRunTime ? parseTime(mrpRunTime).toString() : null;
  const [schedule, setSchedule] = useState<MrpScheduleType>(
    storedTime ? "Daily" : "Every 3 Hours"
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;
    if (fetcher.data.success) {
      toast.success(fetcher.data.message);
    } else {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  const scheduleLabels: Record<MrpScheduleType, string> = {
    "Every 3 Hours": t`Every 3 hours`,
    Daily: t`Once a day`
  };

  // Whole hours, plus the stored time when it is not on the hour (set through
  // the API): offering only hours would save it back cut to the hour.
  const timeOptions = useMemo(() => {
    const times = Array.from({ length: 24 }, (_, hour) =>
      new Time(hour).toString()
    );
    if (storedTime && !times.includes(storedTime)) {
      times.push(storedTime);
      // "HH:MM:SS" strings sort chronologically
      times.sort();
    }
    return times.map((time) => ({
      value: time,
      label: formatTimeOfDay(time, locale)
    }));
  }, [storedTime, locale]);

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={mrpScheduleValidator}
        defaultValues={{
          mrpSchedule: storedTime ? "Daily" : "Every 3 Hours",
          mrpRunTime: storedTime ?? undefined
        }}
        fetcher={fetcher}
      >
        <Hidden name="intent" value="setMrpSchedule" />
        <CardHeader>
          <CardTitle>
            <Trans>MRP Schedule</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Choose when MRP recalculates on its own. You can still run it
              yourself at any time with Recalculate on the planning pages.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8 max-w-[400px]">
            <Select
              name="mrpSchedule"
              label={t`Run MRP`}
              options={mrpScheduleTypes.map((type) => ({
                value: type,
                label: scheduleLabels[type]
              }))}
              onChange={(option) => {
                if (option) setSchedule(option.value as MrpScheduleType);
              }}
            />
            {schedule === "Daily" && (
              <Select
                name="mrpRunTime"
                label={t`At`}
                helperText={t`In your company's time zone (${companyTimeZone}).`}
                options={timeOptions}
              />
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={fetcher.state !== "idle"}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
