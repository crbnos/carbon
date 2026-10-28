// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { serviceErrorMessage, useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

// One settings card = one saved concern (archetype F): how the planning grids
// and demand forecasts head their weekly columns.

export function CalendarWeeksCard({
  useCalendarWeeks
}: {
  useCalendarWeeks: boolean;
}) {
  const { t } = useLingui();
  const [enabled, setEnabled] = useState(useCalendarWeeks);
  const fetcher = useAction({
    onSuccess: ({ data }) => {
      toast.success(
        data?.useCalendarWeeks
          ? t`Weeks are numbered by calendar week`
          : t`Weeks are numbered from the present week`
      );
    },
    onError: (result) => {
      // the switch moved before the save: put it back
      setEnabled(useCalendarWeeks);
      toast.error(
        serviceErrorMessage(result) ?? t`Failed to update the setting`
      );
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Calendar Weeks</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            How the weekly columns of Material Planning, Production Planning and
            Demand Forecasts are numbered.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <HStack className="justify-between items-center">
          <VStack className="items-start" spacing={1}>
            <span className="font-medium">
              {enabled ? (
                <Trans>Number weeks by calendar week</Trans>
              ) : (
                <Trans>Number weeks from the present week</Trans>
              )}
            </span>
            <span className="text-sm text-muted-foreground">
              {enabled ? (
                <Trans>
                  Each week is headed with its ISO 8601 week of the year: Week
                  44, Week 45, Week 46.
                </Trans>
              ) : (
                <Trans>
                  Weeks are counted from today: Present Week, Week 2, Week 3.
                </Trans>
              )}
            </span>
          </VStack>
          <Switch
            checked={enabled}
            disabled={fetcher.state !== "idle"}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              fetcher.submit(
                {
                  intent: "setCalendarWeeks",
                  enabled: checked.toString()
                },
                { method: "post" }
              );
            }}
          />
        </HStack>
      </CardContent>
    </Card>
  );
}
