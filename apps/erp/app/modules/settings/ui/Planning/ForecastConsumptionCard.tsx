import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

// The forecast consumption window (weeks). When actual demand lands in a
// week whose forecast is already used up, MRP consumes remaining forecast
// from up to `backward` weeks earlier, then `forward` weeks later, instead
// of double-counting the demand. 0/0 restricts netting to the same week.

export function ForecastConsumptionCard({
  backwardPeriods,
  forwardPeriods
}: {
  backwardPeriods: number;
  forwardPeriods: number;
}) {
  const { t } = useLingui();
  const consumptionFetcher = useFetcher<{
    success: boolean;
    message: string;
  }>();
  const [backward, setBackward] = useState(backwardPeriods);
  const [forward, setForward] = useState(forwardPeriods);

  useEffect(() => {
    if (
      consumptionFetcher.data?.success === true &&
      consumptionFetcher.data?.message
    ) {
      toast.success(consumptionFetcher.data.message);
    }
    if (
      consumptionFetcher.data?.success === false &&
      consumptionFetcher.data?.message
    ) {
      toast.error(consumptionFetcher.data.message);
    }
  }, [consumptionFetcher.data?.message, consumptionFetcher.data?.success]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Forecast Consumption</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            When a sales order or job lands in a week with no remaining
            forecast, it consumes forecast from up to this many weeks back, then
            forward, instead of double-counting demand. Set both to 0 to
            restrict netting to the same week.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label>
              <Trans>Consume forecast backward (weeks)</Trans>
            </Label>
            <div className="w-[160px]">
              <NumberField
                value={backward}
                minValue={0}
                maxValue={52}
                onChange={(value) =>
                  setBackward(Number.isNaN(value) ? 0 : value)
                }
              >
                <NumberInputGroup className="relative">
                  <NumberInput />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInputGroup>
              </NumberField>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>
              <Trans>Consume forecast forward (weeks)</Trans>
            </Label>
            <div className="w-[160px]">
              <NumberField
                value={forward}
                minValue={0}
                maxValue={52}
                onChange={(value) =>
                  setForward(Number.isNaN(value) ? 0 : value)
                }
              >
                <NumberInputGroup className="relative">
                  <NumberInput />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInputGroup>
              </NumberField>
            </div>
          </div>
          <Button
            size="sm"
            isLoading={consumptionFetcher.state !== "idle"}
            onClick={() => {
              const formData = new FormData();
              formData.set("intent", "setForecastConsumption");
              formData.set("backwardPeriods", String(backward));
              formData.set("forwardPeriods", String(forward));
              consumptionFetcher.submit(formData, { method: "POST" });
            }}
          >
            {t`Save`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
