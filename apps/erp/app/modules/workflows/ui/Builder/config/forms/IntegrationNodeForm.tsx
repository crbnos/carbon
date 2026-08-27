import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import type { OptionsSource, ValueOrRef } from "@carbon/workflows";
import {
  INTEGRATION_CONNECTION_INPUT,
  integrationStepId,
  WORKFLOW_INTEGRATION_CATALOG
} from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { Link, useFetcher } from "react-router";
import { path } from "~/utils/path";
import {
  actionInputLabelKey,
  useWorkflowCatalog,
  useWorkflowLabel,
  workflowFieldHelp
} from "../../catalog";
import { useBuilderStore } from "../../context";
import { lockedChoices, useChoiceOptions } from "../../fields/choiceOptions";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";
import { renderStepInput } from "./StepInput";

/** Piece name → its steps, in catalog order. */
const STEPS_BY_PIECE: Map<string, { id: string; action: string }[]> = (() => {
  const byPiece = new Map<string, { id: string; action: string }[]>();
  for (const [id, step] of Object.entries(WORKFLOW_INTEGRATION_CATALOG)) {
    const list = byPiece.get(step.piece.name) ?? [];
    list.push({ id, action: step.piece.action });
    byPiece.set(step.piece.name, list);
  }
  return byPiece;
})();

/** "google-calendar" → "Google Calendar". The piece name is a package slug, and the
 * catalog labels each STEP rather than the app, so this is the readable form. */
function pieceLabel(piece: string): string {
  return piece
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Whether the company has any account connected for this app.
 *
 * The provider comes off the step's own connection input rather than being named here, so
 * this asks the same question, of the same resolver, that the input itself would. Its own
 * fetcher key per app, so switching apps asks again instead of reusing the last answer.
 */
function useHasConnection(piece: string, source: OptionsSource | undefined) {
  const fetcher = useFetcher<{ options: { value: string }[] }>({
    key: `integration-connections:${piece}`
  });

  const query = useMemo(() => {
    if (source === undefined) return undefined;
    const params = new URLSearchParams({ provider: source.provider });
    if (source.params) params.set("params", JSON.stringify(source.params));
    return params.toString();
  }, [source]);

  useEffect(() => {
    if (query === undefined) return;
    if (fetcher.state === "idle" && fetcher.data === undefined) {
      fetcher.load(`${path.to.api.workflowOptions}?${query}`);
    }
  }, [fetcher, query]);

  return {
    checked: fetcher.data !== undefined,
    connected: (fetcher.data?.options.length ?? 0) > 0
  };
}

export function IntegrationNodeForm({
  node,
  issues,
  isReadOnly
}: NodeFormProps<"integration">) {
  const { t } = useLingui();
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const label = useWorkflowLabel();
  const catalog = useWorkflowCatalog();
  const choiceOptions = useChoiceOptions();

  const { piece, action, inputs } = node.data;

  const stepId = piece && action ? integrationStepId(piece, action) : undefined;
  const step = stepId ? catalog.getIntegration(stepId) : undefined;

  const pieceNames = useMemo(() => [...STEPS_BY_PIECE.keys()].sort(), []);
  const steps = STEPS_BY_PIECE.get(piece) ?? [];

  // Every step of an app shares one connection input, so the first step answers for the
  // app — which is what lets this be asked before a step has been picked.
  const connectionSource = useMemo(() => {
    const first = steps[0];
    if (first === undefined) return undefined;
    return catalog.getIntegration(first.id)?.inputs[
      INTEGRATION_CONNECTION_INPUT
    ]?.options;
  }, [steps, catalog]);

  const { checked, connected } = useHasConnection(piece, connectionSource);
  const appName = piece ? pieceLabel(piece) : "";

  const inputLabel = (name: string) =>
    label(
      actionInputLabelKey(stepId ?? "", name),
      catalog.getInputLabel(stepId ?? "", name) ?? name
    );

  // Changing the app invalidates the step, and changing either invalidates every
  // input: a calendar id means nothing to a different app or a different step.
  function handlePieceChange(next: string) {
    if (next === piece) return;
    updateNodeData(node.id, { piece: next, action: "", inputs: {} });
  }

  function handleStepChange(next: string) {
    if (next === action) return;
    updateNodeData(node.id, { action: next, inputs: {} });
  }

  function handleInputChange(name: string, value: ValueOrRef | undefined) {
    const next = { ...inputs };
    if (value === undefined) delete next[name];
    else next[name] = value;
    updateNodeData(node.id, { inputs: next });
  }

  // Required first, then optional, preserving catalog order within each — the same
  // ordering the action form uses.
  const inputNames = useMemo(() => {
    if (!step) return [];
    const required: string[] = [];
    const optional: string[] = [];
    for (const [name, inputDef] of Object.entries(step.inputs)) {
      if (inputDef.required) required.push(name);
      else optional.push(name);
    }
    return [...required, ...optional];
  }, [step]);

  return (
    <FormStack spacing={4}>
      <div className="space-y-1">
        <Section>
          <Trans>App</Trans>
        </Section>
        <Select
          value={piece}
          onValueChange={handlePieceChange}
          disabled={isReadOnly}
        >
          <SelectTrigger className="w-full" disabled={isReadOnly}>
            <SelectValue placeholder={t`Select an app…`} />
          </SelectTrigger>
          <SelectContent>
            {pieceNames.map((name) => (
              <SelectItem key={name} value={name}>
                {pieceLabel(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {piece && checked && !connected && (
        <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4">
          <p className="text-sm text-muted-foreground">
            <Trans>
              {appName} isn't connected yet. Connect an account before this step
              can do anything.
            </Trans>
          </p>
          <Button asChild variant="secondary" isDisabled={isReadOnly}>
            <Link
              to={path.to.integration(piece)}
              target="_blank"
              rel="noreferrer"
            >
              <Trans>Connect {appName}</Trans>
            </Link>
          </Button>
        </div>
      )}

      {piece && connected && (
        <div className="space-y-1">
          <Section>
            <Trans>Step</Trans>
          </Section>
          <Select
            value={action}
            onValueChange={handleStepChange}
            disabled={isReadOnly}
          >
            <SelectTrigger className="w-full" disabled={isReadOnly}>
              <SelectValue placeholder={t`Select a step…`} />
            </SelectTrigger>
            <SelectContent>
              {steps.map((entry) => (
                <SelectItem key={entry.id} value={entry.action}>
                  {label(entry.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {connected && step && inputNames.length > 0 && (
        <div className="space-y-3">
          <Section>
            <Trans>Inputs</Trans>
          </Section>
          {inputNames.map((name) => {
            const inputDef = step.inputs[name];
            if (!inputDef) return null;
            return renderStepInput({
              name,
              inputDef,
              label: inputLabel(name),
              helpTermId: workflowFieldHelp(
                actionInputLabelKey(stepId ?? "", name)
              ),
              inputs,
              issues,
              nodeId: node.id,
              // A piece step is never batchable, so an input never stands for a
              // loop item here.
              batching: false,
              isReadOnly,
              onChange: handleInputChange,
              labelFor: inputLabel,
              choiceOptions,
              lockedChoices
            });
          })}
        </div>
      )}
    </FormStack>
  );
}
