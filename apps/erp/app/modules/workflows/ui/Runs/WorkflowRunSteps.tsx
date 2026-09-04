import type { WorkflowDefinition, WorkflowNode } from "@carbon/workflows";
import { topologicalNodeOrder } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { MAX_RUN_STEPS, type WorkflowRunStep } from "../../workflows.service";
import { useWorkflowLabel } from "../Builder/catalog";
import {
  actionInputLabelKey,
  operationInputLabelKey,
  outputLabel
} from "../Builder/labelKeys";
import {
  humanizeField,
  metaForNodeType,
  NODE_KIND_META
} from "../Builder/nodes/meta";
import { ConditionDetail } from "./ConditionDetail";
import { StepStatus } from "./RunStatus";
import { ValueMap } from "./RuntimeValueView";
import { useNodeLabel } from "./useNodeLabel";

/** Only the columns this component renders, so an unsaved test run can feed it too. */
export type RunStepView = Pick<
  WorkflowRunStep,
  | "sequence"
  | "nodeId"
  | "nodeType"
  | "itemKey"
  | "status"
  | "statusReason"
  | "input"
  | "output"
  | "detail"
  | "branchTaken"
  | "durationMs"
>;

type WorkflowRunStepsProps = {
  steps: RunStepView[];
  definition: WorkflowDefinition | null;
  compacted: boolean;
  stepsPurged: boolean;
  /** More steps exist than the loader returned — say so rather than cap silently. */
  truncated: boolean;
  /** Record ids resolved to the name a person recognises, keyed `${table}:${id}`. */
  recordNames: Record<string, string>;
};

function durationLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getListCount(output: unknown): number | null {
  if (!output || typeof output !== "object") return null;
  const obj = output as Record<string, unknown>;
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") {
      const v = val as Record<string, unknown>;
      if (v.kind === "list" && Array.isArray(v.items)) {
        return v.items.length;
      }
    }
  }
  return null;
}

function ExpandedSection({
  label,
  note,
  children
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {note && <p className="text-xs text-muted-foreground italic">{note}</p>}
      <div className="pl-2">{children}</div>
    </div>
  );
}

/** New runs record the values a step actually used under `resolved`; older runs only
 * ever stored its configuration. Tell them apart so neither is mislabelled. */
function stepInputView(input: unknown): { value: unknown; resolved: boolean } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { value: input, resolved: false };
  }
  const obj = input as Record<string, unknown>;
  if (obj.resolved !== undefined)
    return { value: obj.resolved, resolved: true };
  if (obj.inputs !== undefined) return { value: obj.inputs, resolved: false };
  return { value: input, resolved: false };
}

/** An action or compute step names its inputs in the catalog ("Title", "Assignee");
 * every other kind has no catalog entry, so its keys keep the humanised form. */
function inputLabelResolver(
  node: WorkflowNode | undefined,
  label: (key: string, fallback?: string) => string
): ((key: string) => string) | undefined {
  if (node === undefined) return undefined;
  const catalogId = NODE_KIND_META[node.type].catalogId?.(node);
  if (catalogId === undefined) return undefined;
  if (node.type === "action") {
    return (key) =>
      label(actionInputLabelKey(catalogId, key), humanizeField(key));
  }
  if (node.type === "compute") {
    return (key) =>
      label(operationInputLabelKey(catalogId, key), humanizeField(key));
  }
  return undefined;
}

function StepRow({
  step,
  nodeTitle,
  nodeSubtitle,
  nodeIcon,
  nodeKind,
  notReachedReason,
  defaultExpanded = false,
  node,
  recordNames
}: {
  step: RunStepView | null;
  nodeTitle: string;
  nodeSubtitle?: string;
  nodeIcon: React.ReactNode;
  nodeKind?: string;
  notReachedReason?: string;
  defaultExpanded?: boolean;
  node?: WorkflowNode;
  recordNames: Record<string, string>;
}) {
  const { t } = useLingui();
  const label = useWorkflowLabel();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [raw, setRaw] = useState(false);
  const isNotReached = step === null;

  if (isNotReached) {
    return (
      <div className="flex items-center gap-3 py-3 px-3 border-b border-border/50 border-l-2 border-dashed border-border">
        <span className="text-muted-foreground">{nodeIcon}</span>
        <span className="text-sm text-muted-foreground">{nodeTitle}</span>
        {nodeKind && (
          <span className="text-xs text-muted-foreground shrink-0">
            {nodeKind}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground italic">
          {notReachedReason ?? t`Not reached`}
        </span>
      </div>
    );
  }

  const hasDetail =
    step.input !== null || step.output !== null || step.detail !== null;
  const listCount = getListCount(step.output);
  const input = stepInputView(step.input);
  const inputLabelFor = inputLabelResolver(node, label);

  return (
    <div className="border-b border-border/50">
      <button
        type="button"
        className="w-full flex items-center gap-3 py-3 px-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => hasDetail && setExpanded((p) => !p)}
        disabled={!hasDetail}
      >
        {hasDetail ? (
          expanded ? (
            <LuChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          ) : (
            <LuChevronRight className="size-3.5 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span className="text-muted-foreground shrink-0">{nodeIcon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate min-w-0">
              {nodeTitle}
            </span>
            {nodeKind && (
              <span className="text-xs text-muted-foreground shrink-0">
                {nodeKind}
              </span>
            )}
            {listCount !== null && (
              <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0">
                {listCount} {listCount === 1 ? t`item` : t`items`}
              </span>
            )}
          </div>
          {nodeSubtitle && (
            <p className="text-xs text-muted-foreground truncate">
              {nodeSubtitle}
            </p>
          )}
          {step.statusReason && (
            <p className="text-xs text-muted-foreground">{step.statusReason}</p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">
            {durationLabel(step.durationMs)}
          </span>
          <StepStatus status={step.status} />
        </div>
      </button>

      {expanded && hasDetail && (
        <div className="px-10 pb-3 space-y-3">
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setRaw((p) => !p)}
          >
            {raw ? t`Show summary` : t`Show raw`}
          </button>
          {raw ? (
            <pre className="overflow-auto rounded bg-muted px-2 py-1 text-xs font-mono whitespace-pre-wrap max-h-96">
              {JSON.stringify(
                {
                  input: step.input,
                  output: step.output,
                  detail: step.detail
                },
                null,
                2
              )}
            </pre>
          ) : (
            <>
              {step.input !== null && (
                <ExpandedSection
                  label={t`Input`}
                  note={
                    input.resolved
                      ? undefined
                      : t`The step's settings — this run predates recording the values it used.`
                  }
                >
                  <ValueMap
                    value={input.value}
                    labelFor={inputLabelFor}
                    recordNames={recordNames}
                  />
                </ExpandedSection>
              )}
              {step.output !== null && (
                <ExpandedSection label={t`Output`}>
                  <ValueMap
                    value={step.output}
                    labelFor={outputLabel}
                    recordNames={recordNames}
                  />
                </ExpandedSection>
              )}
              {step.detail !== null && (
                <ExpandedSection label={t`Why`}>
                  <ConditionDetail
                    detail={step.detail}
                    node={node?.type === "condition" ? node : undefined}
                  />
                </ExpandedSection>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function stepRowFromType(
  step: RunStepView,
  recordNames: Record<string, string>
) {
  const meta = metaForNodeType(step.nodeType);
  const Icon = meta?.Icon;
  return (
    <StepRow
      key={step.nodeId}
      step={step}
      nodeTitle={meta?.defaultTitle ?? step.nodeType}
      nodeIcon={Icon ? <Icon className="size-3.5" /> : null}
      nodeKind={meta?.name}
      recordNames={recordNames}
    />
  );
}

export function WorkflowRunSteps({
  steps,
  definition,
  compacted,
  stepsPurged,
  truncated,
  recordNames
}: WorkflowRunStepsProps) {
  const nodeLabel = useNodeLabel();

  if (stepsPurged) {
    return (
      <div className="py-6 px-4 text-sm text-muted-foreground text-center">
        <Trans>
          Step detail is kept for 30 days. This run's steps have been removed.
        </Trans>
      </div>
    );
  }

  // Run-level, not per-node: a precise per-node reachability walk is not worth
  // the complexity when one cause explains every unreached step in practice.
  const nodeSteps = steps.filter((s) => !s.itemKey || s.itemKey === "");
  const notReachedReason = nodeSteps.some((s) => s.branchTaken === "none")
    ? "Skipped — the check above didn't match"
    : nodeSteps.some((s) => s.status === "Failed")
      ? "Skipped — an earlier step failed"
      : "Not reached";

  const focusStep =
    nodeSteps.find((s) => s.status === "Failed") ??
    nodeSteps.find((s) => s.branchTaken === "none") ??
    nodeSteps.find((s) => s.status === "Skipped") ??
    null;

  // Group steps by nodeId, picking the node-level row (itemKey === "")
  const stepsByNode = new Map<string, RunStepView>();
  for (const step of steps) {
    if (!step.itemKey || step.itemKey === "") {
      stepsByNode.set(step.nodeId, step);
    }
  }

  // If no definition, just show steps in sequence order
  if (!definition) {
    const sorted = [...steps]
      .filter((s) => !s.itemKey || s.itemKey === "")
      // New runs reserve sequence 0 for the trigger and start the walk at 1, so
      // this tiebreak only still matters for runs recorded before that change.
      .sort((a, b) =>
        a.sequence === b.sequence
          ? Number(b.nodeType === "trigger") - Number(a.nodeType === "trigger")
          : a.sequence - b.sequence
      );
    return (
      <div className="divide-y-0">
        {sorted.map((step) => stepRowFromType(step, recordNames))}
      </div>
    );
  }

  const order = topologicalNodeOrder(definition);
  const nodeMap = new Map(definition.nodes.map((n) => [n.id, n]));

  // Find steps whose nodeId is not in definition order
  const orderedSet = new Set(order);
  const orphanSteps = steps
    .filter(
      (s) => !orderedSet.has(s.nodeId) && (!s.itemKey || s.itemKey === "")
    )
    .sort((a, b) => a.sequence - b.sequence);

  return (
    <div>
      {compacted && (
        <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/50">
          <Trans>
            Values in this run have been summarised. Full detail is kept for 7
            days.
          </Trans>
        </div>
      )}
      {truncated && (
        <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/50">
          <Trans>
            This run has more steps than we show here. Only the first{" "}
            {MAX_RUN_STEPS} are listed.
          </Trans>
        </div>
      )}
      <div>
        {order.map((nodeId) => {
          const node = nodeMap.get(nodeId);
          if (!node) return null;
          const meta = NODE_KIND_META[node.type];
          const Icon = meta.Icon;
          const step = stepsByNode.get(nodeId) ?? null;
          const { title, subtitle, kind } = nodeLabel(node);

          return (
            <StepRow
              key={nodeId}
              step={step}
              nodeTitle={title}
              nodeSubtitle={subtitle === "" ? undefined : subtitle}
              nodeIcon={<Icon className="size-3.5" />}
              nodeKind={kind}
              notReachedReason={notReachedReason}
              defaultExpanded={
                step?.nodeId === focusStep?.nodeId && focusStep !== null
              }
              node={node}
              recordNames={recordNames}
            />
          );
        })}
        {orphanSteps.map((step) => stepRowFromType(step, recordNames))}
      </div>
    </div>
  );
}
