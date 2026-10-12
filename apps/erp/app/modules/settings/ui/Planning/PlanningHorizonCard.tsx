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
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Hidden, Number, Submit } from "~/components/Form";
import { planningHorizonValidator } from "~/modules/settings";

// One settings card = one saved concern (archetype F): the company-wide
// planning horizon (time fence). An item's own horizon on its Planning tab
// wins; an item with neither has no fence.

export function PlanningHorizonCard({
  defaultPlanningHorizonDays
}: {
  defaultPlanningHorizonDays: number | null;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;
    if (fetcher.data.success) {
      toast.success(fetcher.data.message);
    } else {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={planningHorizonValidator}
        defaultValues={{ days: defaultPlanningHorizonDays ?? undefined }}
        fetcher={fetcher}
      >
        <Hidden name="intent" value="setPlanningHorizon" />
        <CardHeader>
          <CardTitle>
            <Trans>Planning Horizon</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Material planning shows only the actions and suggested orders due
              within this many days from today, so far-out needs stay out of the
              way until they matter. An item's own planning horizon overrides
              this default.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8 max-w-[400px]">
            <Number
              name="days"
              label={t`Default horizon (days)`}
              minValue={0}
              maxValue={3650}
              helperText={t`Leave empty, or enter 0, to show everything MRP plans.`}
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
  );
}
