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
import { Trans, useLingui } from "@lingui/react/macro";
import { LuLoaderCircle } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime } from "~/components";
import type { CompanyTemplateRun } from "~/modules/settings";
import { path } from "~/utils/path";

/**
 * `onResolve` hides the row the moment the user acts rather than when the async
 * finalize/revert lands — otherwise it lingers and reads as "nothing happened".
 */
export function TemplateReviewRow({
  run,
  datasetLabel,
  onResolve
}: {
  run: CompanyTemplateRun;
  datasetLabel: string | null;
  onResolve: (templateRunId: string) => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const busy = run.status === "running" || run.status === "reverting";

  const submit = (intent: "keep" | "revert" | "dismiss") => {
    onResolve(run.templateRunId);
    fetcher.submit(
      { intent, templateRunId: run.templateRunId },
      { method: "post", action: path.to.demoData }
    );
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Demo data applied</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Demo data was applied to this company. Keep it, or revert to put
            back exactly what was here before.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <HStack className="w-full justify-between border rounded-lg p-3">
          <VStack spacing={0} className="min-w-0">
            <span className="text-sm font-medium truncate">
              {datasetLabel ?? run.datasetKey ?? t`Demo data`}
            </span>
            {run.status === "failed" ? (
              <span className="text-xs text-destructive-foreground">
                {t`Failed`} — {run.error ?? t`unknown error`}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {run.startedAt && (
                  <DateTime value={run.startedAt} variant="absolute" />
                )}
                {" · "}
                {run.status === "running"
                  ? t`applying…`
                  : run.status === "reverting"
                    ? t`reverting…`
                    : t`ready to keep or revert`}
              </span>
            )}
          </VStack>
          <HStack spacing={2} className="shrink-0">
            {run.status === "ready" && (
              <>
                <Button onClick={() => submit("keep")}>
                  <Trans>Keep</Trans>
                </Button>
                <Button variant="destructive" onClick={() => submit("revert")}>
                  <Trans>Revert</Trans>
                </Button>
              </>
            )}
            {run.status === "failed" && (
              <Button variant="secondary" onClick={() => submit("dismiss")}>
                <Trans>Dismiss</Trans>
              </Button>
            )}
            {busy && (
              <LuLoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </HStack>
        </HStack>
      </CardContent>
    </Card>
  );
}
