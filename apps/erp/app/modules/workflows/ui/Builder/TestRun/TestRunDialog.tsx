import {
  Button,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import type { ValueType, WorkflowIssue } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { catalog, useWorkflowLabel } from "../catalog";
import { useBuilderStore, useBuilderStoreApi } from "../context";
import { humanizeField } from "../nodes/meta";
import type { TestRunResult } from "../store";
import { useDefinition } from "../useDefinition";
import { RecordPickerFor } from "./TestRecordPicker";

type TestRunResponse =
  | {
      ok: true;
      status: "Succeeded" | "Failed";
      error: string | null;
      steps: TestRunResult["steps"];
      truncated: boolean;
    }
  | { ok: false; error: string; issues: WorkflowIssue[] };

/** Entity-typed outputs of an event, in declaration order — one picker each. */
function entityOutputs(outputs: Record<string, ValueType>) {
  return Object.entries(outputs).flatMap(([name, type]) =>
    type.kind === "entity" ? [{ name, entity: type.of }] : []
  );
}

/**
 * Confirms and fires a manual test run. Rendered once at page level, never inside a
 * node card — the canvas only renders visible nodes, so a card-owned dialog would
 * unmount mid-run when its node scrolled away.
 *
 * This outer component owns the fetcher because submitting closes the dialog: a
 * fetcher whose component unmounts is never told the result, so the run would go out,
 * really happen, and report nothing back.
 */
export function TestRunDialog({
  workflowId,
  versionId
}: {
  workflowId: string;
  versionId: string;
}) {
  const store = useBuilderStoreApi();
  const testRunFor = useBuilderStore((s) => s.testRunFor);
  const fetcher = useFetcher<TestRunResponse>();

  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data === undefined) return;
    const state = store.getState();
    state.setTestRunResult(
      fetcher.data.ok
        ? {
            status: fetcher.data.status,
            steps: fetcher.data.steps,
            truncated: fetcher.data.truncated,
            error: fetcher.data.error,
            issues: []
          }
        : {
            status: "Failed",
            steps: [],
            truncated: false,
            error: fetcher.data.error,
            issues: fetcher.data.issues
          }
    );
    state.setTestRunStatus("idle");
  }, [fetcher.data, fetcher.state, store]);

  const run = useCallback(
    (formData: FormData) => {
      const state = store.getState();
      state.setTestRunStatus("running");
      state.setTestRunResult(null);
      state.closeTestRun();
      // The run is recorded against the version being edited, so its history row
      // points at a definition someone can actually open.
      formData.append("versionId", versionId);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.workflowTestRun(workflowId)
      });
    },
    [fetcher, store, versionId, workflowId]
  );

  if (testRunFor === null) return null;
  return <Dialog workflowId={workflowId} nodeId={testRunFor} onRun={run} />;
}

function Dialog({
  workflowId,
  nodeId,
  onRun
}: {
  workflowId: string;
  nodeId: string;
  onRun: (formData: FormData) => void;
}) {
  const { t } = useLingui();
  const label = useWorkflowLabel();
  const closeTestRun = useBuilderStore((s) => s.closeTestRun);
  const definition = useDefinition();

  const node = definition.nodes.find((one) => one.id === nodeId);
  const data = node?.type === "trigger" ? node.data : undefined;
  const events = useMemo(() => data?.events ?? [], [data]);
  const isScheduleMode = !!data?.schedule;

  const [eventId, setEventId] = useState(() => events[0] ?? "");
  const [picked, setPicked] = useState<Record<string, string | undefined>>({});
  const [previousValue, setPreviousValue] = useState("");

  const event = eventId ? catalog.getEvent(eventId) : undefined;
  const match = event?.match;

  // Which record(s) the author has to supply for this event to mean anything.
  const pickers = useMemo(() => {
    if (event === undefined || match === undefined) return [];
    if ("moment" in match) return entityOutputs(event.outputs);
    const record = event.outputs.record;
    return record?.kind === "entity"
      ? [{ name: "record", entity: record.of }]
      : [];
  }, [event, match]);

  const watchedField = match && "table" in match ? match.field : undefined;
  const isReady =
    (isScheduleMode || eventId !== "") &&
    pickers.every((one) => picked[one.name]);

  function submit() {
    const triggerInput =
      match === undefined
        ? {}
        : "moment" in match
          ? {
              outputs: Object.fromEntries(
                pickers.map((one) => [one.name, picked[one.name] ?? ""])
              )
            }
          : { recordId: picked.record ?? "" };

    const formData = new FormData();
    formData.append("nodes", JSON.stringify(definition.nodes));
    formData.append("edges", JSON.stringify(definition.edges));
    formData.append("formatVersion", String(definition.formatVersion));
    formData.append("triggerNodeId", nodeId);
    formData.append("eventId", eventId);
    formData.append("triggerInput", JSON.stringify(triggerInput));
    if (previousValue) formData.append("previousValue", previousValue);

    onRun(formData);
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) closeTestRun();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{t`Run this workflow now?`}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-sm">
              <Trans>
                This runs the workflow for real. It will create records, send
                notifications and call any webhooks exactly as a live run would.
                This cannot be undone.
              </Trans>
            </p>
            <p className="text-xs text-muted-foreground">
              <Trans>The result will not appear on the Runs page.</Trans>
            </p>

            {!isScheduleMode && events.length > 1 && (
              <VStack spacing={1}>
                <Label>{t`Event`}</Label>
                <Combobox
                  value={eventId}
                  options={events.map((id) => ({
                    value: id,
                    label: label(id)
                  }))}
                  onChange={(next) => {
                    setEventId(next);
                    setPicked({});
                  }}
                />
              </VStack>
            )}

            {pickers.map((one) => (
              <VStack key={one.name} spacing={1}>
                <Label>{humanizeField(one.name)}</Label>
                <RecordPickerFor
                  workflowId={workflowId}
                  entity={one.entity}
                  value={picked[one.name]}
                  onChange={(id) =>
                    setPicked((current) => ({ ...current, [one.name]: id }))
                  }
                />
              </VStack>
            ))}

            {watchedField !== undefined && (
              <VStack spacing={1}>
                <Label>{t`Previous value of ${humanizeField(watchedField)}`}</Label>
                <Input
                  value={previousValue}
                  onChange={(e) => setPreviousValue(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    What this field held before the change. Leave blank for
                    nothing.
                  </Trans>
                </p>
              </VStack>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={closeTestRun}>
            <Trans>Cancel</Trans>
          </Button>
          <Button isDisabled={!isReady} onClick={submit}>
            <Trans>Run test</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
