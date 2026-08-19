import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

/**
 * No typed-confirmation modal on purpose: the safety story is reversibility, and
 * Backups' equally destructive restore is a plain Submit. Friction here but not
 * there would be arbitrary.
 */
export function TemplateCards({
  datasets,
  disabled,
  onApply
}: {
  datasets: { key: string; label: string }[];
  disabled: boolean;
  /** Fired on click so the page can show the run before the job writes its
   *  marker — this fetcher goes idle as soon as the event is QUEUED. Called with
   *  null if the action refused, so the stand-in row doesn't spin forever. */
  onApply: (datasetKey: string | null) => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();

  const refused = fetcher.state === "idle" && fetcher.data?.success === false;
  useEffect(() => {
    if (refused) onApply(null);
  }, [refused, onApply]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Apply a demo template</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Replace this company's data with a demo dataset — snapshotted first,
            so you can revert.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VStack spacing={2}>
          {datasets.map((dataset) => (
            <HStack
              key={dataset.key}
              className="w-full justify-between border rounded-lg p-3"
            >
              <span className="text-sm font-medium truncate">
                {dataset.label}
              </span>
              <Button
                isDisabled={disabled}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("datasetKey") === dataset.key
                }
                onClick={() => {
                  onApply(dataset.key);
                  fetcher.submit(
                    { intent: "apply", datasetKey: dataset.key },
                    { method: "post", action: path.to.demoData }
                  );
                }}
              >
                <Trans>Apply</Trans>
              </Button>
            </HStack>
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
}
