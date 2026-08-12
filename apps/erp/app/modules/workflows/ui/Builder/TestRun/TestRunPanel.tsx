import {
  Alert,
  AlertDescription,
  cn,
  IconButton,
  Spinner
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuX } from "react-icons/lu";
import { RunStatus } from "../../Runs/RunStatus";
import { runOutcome } from "../../Runs/runOutcome";
import { WorkflowRunSteps } from "../../Runs/WorkflowRunSteps";
import { useWorkflowLabel } from "../catalog";
import { useBuilderStore } from "../context";
import { IssueList } from "../IssueList";
import { useDefinition } from "../useDefinition";

/** The result of a manual test run. Nothing was written, so this panel is the only
 * place the run exists — closing it discards it. */
export function TestRunPanel() {
  const { t } = useLingui();
  const label = useWorkflowLabel();
  const definition = useDefinition();
  const status = useBuilderStore((s) => s.testRunStatus);
  const result = useBuilderStore((s) => s.testRunResult);
  const setTestRunResult = useBuilderStore((s) => s.setTestRunResult);
  const setTestRunStatus = useBuilderStore((s) => s.setTestRunStatus);

  // Both, or the panel stays open on an empty result — the group shows it while
  // either is set.
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
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <span className="text-sm font-semibold">
          <Trans>Test run</Trans>
        </span>
        {result && <RunStatus status={result.status} />}
        <IconButton
          aria-label={t`Close`}
          className="ml-auto"
          icon={<LuX />}
          size="sm"
          variant="ghost"
          onClick={close}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
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
      </div>

      <p className="border-t border-border p-3 text-xs text-muted-foreground">
        <Trans>
          Test runs are not saved. Close this panel and the result is gone.
        </Trans>
      </p>
    </div>
  );
}
