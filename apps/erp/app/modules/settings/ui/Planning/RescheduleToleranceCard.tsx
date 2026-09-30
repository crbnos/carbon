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
import { rescheduleToleranceValidator } from "~/modules/settings";

// One settings card = one saved concern (archetype F): the reschedule
// tolerance MRP applies before it raises an Expedite / Defer suggestion.

export function RescheduleToleranceCard({
  rescheduleToleranceDays
}: {
  rescheduleToleranceDays: number;
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
        validator={rescheduleToleranceValidator}
        defaultValues={{ days: rescheduleToleranceDays }}
        fetcher={fetcher}
      >
        <Hidden name="intent" value="setTolerance" />
        <CardHeader>
          <CardTitle>
            <Trans>Reschedule Tolerance</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              MRP suggests moving an existing order only when its date is off by
              more than this many days. Smaller gaps are left alone so the
              worklist stays quiet.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8 max-w-[400px]">
            <Number
              name="days"
              label={t`Tolerance (days)`}
              minValue={0}
              maxValue={365}
              helperText={t`0 suggests a move for any date difference.`}
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
