// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { usesCalendarYearForWeek } from "@carbon/database/sequence-tokens";
import { Alert, AlertDescription, AlertTitle, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";

/** `extraTokens` labels arrive translated, as the date tokens' are here. */
export function SequenceTokenHelp({
  extraTokens = []
}: {
  extraTokens?: ReadonlyArray<readonly [string, string]>;
}) {
  const { t } = useLingui();
  const dateTokens: ReadonlyArray<readonly [string, string]> = [
    ["%{yyyy}", t`Full Year`],
    ["%{yy}", t`Year`],
    ["%{mm}", t`Month`],
    ["%{ww}", t`ISO Week`],
    ["%{wyyyy}", t`Full Year of the ISO Week`],
    ["%{wyy}", t`Year of the ISO Week`],
    ["%{dd}", t`Day`],
    ["%{hh}", t`Hour`],
    ["%{ss}", t`Second`]
  ];

  return (
    <VStack spacing={0}>
      {[...dateTokens, ...extraTokens].map(([token, label]) => (
        <p key={token} className="text-muted-foreground text-sm">
          {`${token} = ${label}`}
        </p>
      ))}
    </VStack>
  );
}

export function WeekYearWarning({
  prefix,
  suffix
}: {
  prefix: string | null | undefined;
  suffix: string | null | undefined;
}) {
  if (!usesCalendarYearForWeek(prefix, suffix)) return null;

  // Named variables, not string literals: Lingui inlines a literal into the
  // message, and the braces of a token then read as message placeholders.
  const calendarWeek = "%{yy}%{ww}";
  const isoWeek = "%{wyy}%{ww}";
  const weekYear = "%{wyy}";
  const fullWeekYear = "%{wyyyy}";
  const week = "%{ww}";

  return (
    <Alert variant="warning">
      <LuTriangleAlert className="w-4 h-4" />
      <AlertTitle>
        <Trans>The week is labelled with the calendar year</Trans>
      </AlertTitle>
      <AlertDescription>
        <Trans>
          Up to three days around each new year belong to an ISO week of the
          other year. On 1 January 2027 {calendarWeek} gives 2753; {isoWeek}{" "}
          gives 2653. Use {weekYear} or {fullWeekYear} with {week}.
        </Trans>
      </AlertDescription>
    </Alert>
  );
}
