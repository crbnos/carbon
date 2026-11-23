// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { WeekNumbering } from "@carbon/database/sequence-tokens";
import { VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";

export function useWeekNumberingLabels(): Record<WeekNumbering, string> {
  const { t } = useLingui();
  return { iso: t`ISO 8601`, us: t`US` };
}

/** `extraTokens` labels arrive translated, as the date tokens' are here. */
export function SequenceTokenHelp({
  weekNumbering,
  extraTokens = []
}: {
  weekNumbering: WeekNumbering;
  extraTokens?: ReadonlyArray<readonly [string, string]>;
}) {
  const { t } = useLingui();
  const numbering = useWeekNumberingLabels()[weekNumbering];
  const dateTokens: ReadonlyArray<readonly [string, string]> = [
    ["%{yyyy}", t`Full Year`],
    ["%{yy}", t`Year`],
    ["%{mm}", t`Month`],
    ["%{ww}", t`Week (${numbering})`],
    ["%{dd}", t`Day`],
    ["%{hh}", t`Hour`],
    ["%{ss}", t`Second`]
  ];

  // Named variables, not string literals: Lingui inlines a literal into the
  // message, and the braces of a token then read as message placeholders.
  const week = "%{ww}";
  const month = "%{mm}";
  const day = "%{dd}";

  return (
    <VStack spacing={0}>
      {[...dateTokens, ...extraTokens].map(([token, label]) => (
        <p key={token} className="text-muted-foreground text-sm">
          {`${token} = ${label}`}
        </p>
      ))}
      <p className="text-muted-foreground text-sm pt-2">
        {weekNumbering === "iso" ? (
          <Trans>
            With {week} and no {month} or {day}, the year is the year the week
            belongs to: 1 January 2027 is in week 53 of 2026.
          </Trans>
        ) : null}{" "}
        <Trans>Weeks are numbered in Settings → Company.</Trans>
      </p>
    </VStack>
  );
}
