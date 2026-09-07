import {
  Alert,
  AlertDescription,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Spinner
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { RunStatus } from "../../Runs/RunStatus";
import { runOutcome } from "../../Runs/runOutcome";
import { WorkflowRunSteps } from "../../Runs/WorkflowRunSteps";
import { useWorkflowLabel } from "../catalog";
import { useBuilderStore } from "../context";
import { IssueList } from "../IssueList";
import { useDefinition } from "../useDefinition";

/** The result of a manual test run, in the application's standard drawer — the
 * same shell as an integration's details or a saved run. Nothing was written,
 * so this drawer is the only place the run exists: closing it discards it. */
export function TestRunPanel() {
  const label = useWorkflowLabel();
  const definition = useDefinition();
  const status = useBuilderStore((s) => s.testRunStatus);
  const result = useBuilderStore((s) => s.testRunResult);
  const setTestRunResult = useBuilderStore((s) => s.setTestRunResult);
  const setTestRunStatus = useBuilderStore((s) => s.setTestRunStatus);

  // Both, or the drawer stays open on an empty result — the builder shows it
  // while either is set.
  function close() {
    setTestRunResult(null);
    setTestRunStatus("idle");
  }

  const outcome = result
    ? runOutcome(
        { status: result.status, error: result.error, statusReason: null },
        result.steps,
        definition,
        label
      )
    : null;

  // Nothing ran, so there is no step list to explain the failure — say it plainly.
  const isRefusal =
    result !== null && result.error !== null && !result.steps.length;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <div className="flex items-center gap-2">
            <DrawerTitle>
              <Trans>Test run</Trans>
            </DrawerTitle>
            {result && <RunStatus status={result.status} />}
          </div>
        </DrawerHeader>
        <DrawerBody className="p-0">
          {status === "running" ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              <Trans>Running…</Trans>
            </div>
          ) : isRefusal ? (
            <>
              <Alert variant="destructive" className="m-3 w-auto">
                <AlertDescription>{result?.error}</AlertDescription>
              </Alert>
              {result && <IssueList issues={result.issues} />}
            </>
          ) : (
            result && (
              <>
                {outcome && (
                  <p
                    className={cn(
                      "border-b border-border p-3 text-sm",
                      outcome.tone === "danger" && "text-destructive",
                      outcome.tone === "neutral" && "text-muted-foreground"
                    )}
                  >
                    {outcome.text}
                  </p>
                )}
                <WorkflowRunSteps
                  steps={result.steps}
                  definition={definition}
                  compacted={false}
                  stepsPurged={false}
                  truncated={result.truncated}
                  recordNames={{}}
                />
              </>
            )
          )}
        </DrawerBody>
        <DrawerFooter>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Test runs are not saved. Close this panel and the result is gone.
            </Trans>
          </p>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
