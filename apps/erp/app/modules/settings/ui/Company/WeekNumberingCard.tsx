// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { WeekNumbering } from "@carbon/database/sequence-tokens";
import { useControlField, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ChoiceSelect,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCalendar, LuCalendarDays, LuTriangleAlert } from "react-icons/lu";
import { Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { sequenceWeekNumberingValidator } from "~/modules/settings/settings.models";
import { path } from "~/utils/path";
import { useWeekNumberingLabels } from "../Sequences/SequenceTokens";

export function WeekNumberingCard({
  weekNumbering
}: {
  weekNumbering: WeekNumbering;
}) {
  const permissions = usePermissions();
  const labels = useWeekNumberingLabels();
  const fetcher = useAction({
    onSuccess: ({ data }) => {
      const saved = data?.sequenceWeekNumbering as WeekNumbering | undefined;
      if (saved) toast.success(labels[saved]);
    }
  });

  // Named variable, not a string literal: Lingui inlines a literal into the
  // message, and the braces of a token then read as message placeholders.
  const week = "%{ww}";

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.company}
        validator={sequenceWeekNumberingValidator}
        defaultValues={{ sequenceWeekNumbering: weekNumbering }}
        fetcher={fetcher}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Week Numbering</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              How {week} counts weeks in document, serial and batch numbers.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="weekNumbering" />
          <div className="flex flex-col gap-3 max-w-[640px]">
            <WeekNumberingChoice saved={weekNumbering} />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "settings")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}

function WeekNumberingChoice({ saved }: { saved: WeekNumbering }) {
  const { t } = useLingui();
  const labels = useWeekNumberingLabels();
  const [value, setValue] = useControlField<WeekNumbering>(
    "sequenceWeekNumbering"
  );
  const current: WeekNumbering = value ?? saved;
  return (
    <>
      <ChoiceSelect<WeekNumbering>
        aria-label={t`How weeks are numbered`}
        value={current}
        onChange={setValue}
        options={[
          {
            value: "iso",
            title: labels.iso,
            description: t`Weeks start on Monday. Week 1 is the week with the year's first Thursday, so a week is never split: Friday 1 January 2027 is in week 53 of 2026.`,
            icon: <LuCalendarDays />
          },
          {
            value: "us",
            title: labels.us,
            description: t`Weeks start on Sunday. Week 1 is the week of 1 January, so the weeks around a new year are short: 1–2 January 2027 is week 1.`,
            icon: <LuCalendar />
          }
        ]}
      />
      <input type="hidden" name="sequenceWeekNumbering" value={current} />
      {current !== saved ? (
        <Alert variant="warning">
          <LuTriangleAlert className="w-4 h-4" />
          <AlertDescription>
            <Trans>
              Numbers issued after you save count weeks this way. Numbers
              already issued keep their week.
            </Trans>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
