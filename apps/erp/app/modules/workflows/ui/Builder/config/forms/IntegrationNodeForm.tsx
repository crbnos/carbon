// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ValueOrRef } from "@carbon/ee/workflows";
import {
  INTEGRATION_CONNECTION_INPUT,
  integrationAppLabelKey,
  integrationStepId,
  WORKFLOW_INTEGRATION_CATALOG
} from "@carbon/ee/workflows";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { path } from "~/utils/path";
import {
  actionInputLabelKey,
  useWorkflowCatalog,
  useWorkflowLabel
} from "../../catalog";
import { useBuilderStore } from "../../context";
import { useWorkflowOptions } from "../../fields/useWorkflowOptions";
import { useNoticeCopy } from "../../noticeCopy";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";
import { StepInput } from "./StepInput";

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

/** A dashed notice with one link out to the app's accounts, opened in a new tab so
 * the canvas survives. */
function ConnectBanner({
  message,
  href,
  cta,
  isDisabled
}: {
  message: ReactNode;
  href: string;
  cta: ReactNode;
  isDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="secondary" isDisabled={isDisabled}>
        <Link to={href} target="_blank" rel="noreferrer">
          {cta}
        </Link>
      </Button>
    </div>
  );
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

  // Asked through the same resolver the connection input itself uses, with a fetcher
  // key per app so switching apps asks again instead of reusing the last answer.
  const {
    loaded: checked,
    options: connections,
    errorCode: connectionsError,
    errorHref: connectionsFixHref,
    noticeCode: connectionsNotice,
    noticeHref: connectionsNoticeHref,
    isLoading: checkingConnections,
    retry: retryConnections
  } = useWorkflowOptions(
    connectionSource,
    {},
    `integration-connections:${piece}`
  );
  const connected = connections.length > 0;
  // The lookup itself failed, so whether the app is connected is unknown. Saying
  // "isn't connected" would send the author off to add a duplicate account, and
  // hiding the step would hide an existing node's whole configuration.
  const lookupFailed =
    checked &&
    connectionsError !== undefined &&
    connectionsError !== "reconnect";
  const storedConnection = inputs[INTEGRATION_CONNECTION_INPUT];
  const storedConnectionId =
    storedConnection?.kind === "literal" &&
    typeof storedConnection.value === "string"
      ? storedConnection.value
      : undefined;
  // An existing node keeps its configuration on screen even when its app has no
  // usable account left: hiding it would read as the node having been emptied.
  const canConfigure =
    connected || lookupFailed || storedConnectionId !== undefined;
  // The node points at an account the list no longer offers (revoked, or left out
  // until it is reconnected). Never hide the field then — the author must see it.
  const storedNotOffered =
    checked &&
    !lookupFailed &&
    storedConnectionId !== undefined &&
    !connections.some((option) => option.value === storedConnectionId);
  // One connection is not a choice — hide the field, but still STORE the id: a
  // second account added later must not silently repoint existing workflows.
  const onlyConnection =
    connections.length === 1 && !storedNotOffered
      ? connections[0]?.value
      : undefined;

  const appLabel = (name: string) => label(integrationAppLabelKey(name));
  const appName = piece ? appLabel(piece) : "";

  const inputLabel = (name: string) =>
    label(
      actionInputLabelKey(stepId ?? "", name),
      catalog.getInputLabel(stepId ?? "", name) ?? name
    );

  // A record in a field that will not render it as a link — advisory, computed
  // beside liveIssues, shown as one muted line under the field.
  const notices = useBuilderStore((s) => s.notices);
  const noticeCopy = useNoticeCopy();
  const hintFor = (name: string): string | undefined => {
    const notice = notices.find(
      (n) => n.nodeId === node.id && n.field === `inputs.${name}`
    );
    if (notice === undefined) return undefined;
    const sibling =
      notice.params === undefined ? "" : inputLabel(notice.params.input);
    return noticeCopy(notice, appName, sibling);
  };

  // Changing the app invalidates the step, and changing either invalidates every
  // input: a calendar id means nothing to a different app or a different step.
  function handlePieceChange(next: string) {
    if (next === piece) return;
    updateNodeData(node.id, { piece: next, action: "", inputs: {} });
  }

  // Seed the piece's own pre-fills as STORED literals, exactly as ActionForm
  // seeds catalog defaults. What a person sees in an untouched field must be
  // what the run sends: a checkbox whose vendor default is ON rendered as an
  // OFF toggle while sending nothing was a lie in both directions.
  //
  // VISIBLE inputs only. An Advanced input's seeded default would be a node
  // value, and a node value wins over an allowlist pin — seeding there would
  // silently defeat every pin (`singleEvents` first among them). Hidden props
  // are satisfied at run time by the pin or the piece's own default.
  function seededInputs(nextStepId: string): Record<string, ValueOrRef> {
    const definition = catalog.getIntegration(nextStepId);
    const seeded: Record<string, ValueOrRef> = {};
    for (const [name, input] of Object.entries(definition?.inputs ?? {})) {
      if (input.defaultValue === undefined) continue;
      seeded[name] = {
        kind: "literal",
        type: input.type,
        value: input.defaultValue
      };
    }
    return seeded;
  }

  function handleStepChange(next: string) {
    if (next === action) return;
    const seeded = piece ? seededInputs(integrationStepId(piece, next)) : {};
    // The app's connection is shared by every step of the app, so a same-app step
    // change keeps the chosen account — the auto-fill effect only restores it when
    // exactly one account exists, and with two the author had to re-pick each time.
    const connection = inputs[INTEGRATION_CONNECTION_INPUT];
    updateNodeData(node.id, {
      action: next,
      inputs:
        connection === undefined
          ? seeded
          : { ...seeded, [INTEGRATION_CONNECTION_INPUT]: connection }
    });
  }

  function handleInputChange(name: string, value: ValueOrRef | undefined) {
    const next = { ...inputs };
    if (value === undefined) delete next[name];
    else next[name] = value;
    updateNodeData(node.id, { inputs: next });
  }

  // The value is STORED even though no field is shown: the run resolves against it,
  // and a second account added later must not silently repoint existing workflows.
  useEffect(() => {
    // Only once THIS app's connections have come back. Without the gate, the answer
    // still in hand from the previous app could be written into the new app's
    // inputs, pinning a connection that belongs to a different piece.
    if (!checked) return;
    if (onlyConnection === undefined) return;
    if (inputs[INTEGRATION_CONNECTION_INPUT] !== undefined) return;
    updateNodeData(node.id, {
      inputs: {
        ...inputs,
        [INTEGRATION_CONNECTION_INPUT]: {
          kind: "literal",
          type: { kind: "primitive", of: "string" },
          value: onlyConnection
        }
      }
    });
  }, [checked, onlyConnection, inputs, node.id, updateNodeData]);

  // Required first, then optional, preserving catalog order within each — the same
  // ordering the action form uses.
  const inputNames = useMemo(() => {
    if (!step) return [];
    const required: string[] = [];
    const optional: string[] = [];
    for (const [name, inputDef] of Object.entries(step.inputs)) {
      // The connection is stored but not shown when there is only one to pick.
      if (
        name === INTEGRATION_CONNECTION_INPUT &&
        onlyConnection !== undefined
      ) {
        continue;
      }
      if (inputDef.required) required.push(name);
      else optional.push(name);
    }
    return [...required, ...optional];
  }, [step, onlyConnection]);

  // Hidden by the catalog's visibility rules. Shown here, editable, so a hidden
  // field is demoted rather than lost — being wrong about one costs a click.
  const advancedNames = useMemo(
    () => Object.keys(step?.advancedInputs ?? {}),
    [step]
  );

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
                {appLabel(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Connected, but every account predates a scope this app now needs: the
          fix is a re-consent, and "Connect" would send the author to add a
          duplicate account instead. */}
      {piece &&
        checked &&
        !connected &&
        !storedNotOffered &&
        connectionsError === "reconnect" && (
          <ConnectBanner
            message={
              <Trans>
                {appName} is connected, but needs to be reconnected before
                workflow steps can use it.
              </Trans>
            }
            href={connectionsFixHref ?? path.to.integrationAccounts(piece)}
            cta={<Trans>Reconnect {appName}</Trans>}
            isDisabled={isReadOnly}
          />
        )}

      {/* Some accounts are ready, one is not — or this node's stored account is the
          one left out. A non-blocking banner; the field below still works. */}
      {piece &&
        checked &&
        (storedNotOffered ||
          (connected && connectionsNotice === "reconnect")) && (
          <ConnectBanner
            message={
              storedNotOffered ? (
                <Trans>
                  The {appName} account this step uses is not available — it was
                  disconnected or needs to be reconnected.
                </Trans>
              ) : (
                <Trans>
                  One of your {appName} accounts needs to be reconnected before
                  workflow steps can use it.
                </Trans>
              )
            }
            href={connectionsNoticeHref ?? path.to.integrationAccounts(piece)}
            cta={<Trans>Open {appName} accounts</Trans>}
            isDisabled={isReadOnly}
          />
        )}

      {piece && lookupFailed && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-4">
          <p className="text-sm text-muted-foreground">
            {connectionsError === "refreshing" ? (
              <Trans>
                That account is still being reconnected. Try again in a moment.
              </Trans>
            ) : (
              <Trans>Couldn't check whether {appName} is connected.</Trans>
            )}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={retryConnections}
            isDisabled={isReadOnly}
            isLoading={checkingConnections}
          >
            <Trans>Try again</Trans>
          </Button>
        </div>
      )}

      {/* Land on the Accounts tab — where an account is added or reconnected. */}
      {piece &&
        checked &&
        !connected &&
        !storedNotOffered &&
        connectionsError === undefined && (
          <ConnectBanner
            message={
              <Trans>
                {appName} isn't connected yet. Connect an account before this
                step can do anything.
              </Trans>
            }
            href={path.to.integrationAccounts(piece)}
            cta={<Trans>Connect {appName}</Trans>}
            isDisabled={isReadOnly}
          />
        )}

      {piece && canConfigure && (
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

      {canConfigure && step && inputNames.length > 0 && (
        <div className="space-y-3">
          <Section>
            <Trans>Inputs</Trans>
          </Section>
          {inputNames.map((name) => {
            const inputDef = step.inputs[name];
            if (!inputDef) return null;
            return (
              <StepInput
                key={name}
                stepId={stepId ?? ""}
                name={name}
                inputDef={inputDef}
                hint={hintFor(name)}
                inputs={inputs}
                issues={issues}
                nodeId={node.id}
                // A piece step is never batchable, so an input never stands for a
                // loop item here.
                batching={false}
                isReadOnly={isReadOnly}
                onChange={handleInputChange}
              />
            );
          })}
        </div>
      )}

      {canConfigure && step && advancedNames.length > 0 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="border-none">
            <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:no-underline">
              <Trans>Advanced properties</Trans>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
              {advancedNames.map((name) => {
                const inputDef = step.advancedInputs?.[name];
                if (!inputDef) return null;
                return (
                  <StepInput
                    key={name}
                    stepId={stepId ?? ""}
                    name={name}
                    inputDef={inputDef}
                    hint={hintFor(name)}
                    inputs={inputs}
                    issues={issues}
                    nodeId={node.id}
                    batching={false}
                    isReadOnly={isReadOnly}
                    onChange={handleInputChange}
                  />
                );
              })}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </FormStack>
  );
}
