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
import { forecastConsumptionValidator } from "~/modules/settings";

// The forecast consumption window (weekly buckets). Actual demand that lands
// in a week whose forecast is used up consumes forecast from up to
// `backward` weeks earlier, then `forward` weeks later, instead of being
// double-counted. 0 / 0 restricts netting to the same week.

export function ForecastConsumptionCard({
  backwardPeriods,
  forwardPeriods
}: {
  backwardPeriods: number;
  forwardPeriods: number;
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
        validator={forecastConsumptionValidator}
        defaultValues={{ backwardPeriods, forwardPeriods }}
        fetcher={fetcher}
      >
        <Hidden name="intent" value="setForecastConsumption" />
        <CardHeader>
          <CardTitle>
            <Trans>Forecast Consumption</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              When a sales order or job lands in a week with no remaining
              forecast, it consumes forecast from nearby weeks instead of being
              counted on top of it. Set both to 0 to net within the same week
              only.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 w-full max-w-[640px]">
            <Number
              name="backwardPeriods"
              label={t`Look back (weeks)`}
              minValue={0}
              maxValue={52}
              helperText={t`Earlier weeks are consumed first.`}
            />
            <Number
              name="forwardPeriods"
              label={t`Look ahead (weeks)`}
              minValue={0}
              maxValue={52}
              helperText={t`Later weeks are consumed once earlier ones are used up.`}
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
