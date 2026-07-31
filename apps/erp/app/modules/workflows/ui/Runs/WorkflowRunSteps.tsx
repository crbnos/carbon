import type { WorkflowDefinition } from "@carbon/workflows";
import { topologicalNodeOrder } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import type { WorkflowRunStep } from "../../workflows.service";
import { NODE_KIND_META } from "../Builder/nodes/meta";
import { ConditionDetail } from "./ConditionDetail";
import { StepStatus } from "./RunStatus";
import { RuntimeValueView } from "./RuntimeValueView";

type WorkflowRunStepsProps = {
  steps: WorkflowRunStep[];
  definition: WorkflowDefinition | null;
  compacted: boolean;
  stepsPurged: boolean;
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
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="pl-2">{children}</div>
    </div>
  );
}

function StepRow({
  step,
  nodeTitle,
  nodeIcon
}: {
  step: WorkflowRunStep | null;
  nodeTitle: string;
  nodeIcon: React.ReactNode;
}) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const isNotReached = step === null;

  if (isNotReached) {
    return (
      <div className="flex items-center gap-3 py-2 px-3 border-b border-border/50 opacity-40">
        <span className="text-muted-foreground">{nodeIcon}</span>
        <span className="text-sm text-muted-foreground">{nodeTitle}</span>
        <span className="ml-auto text-xs text-muted-foreground italic">
          <Trans>Not reached</Trans>
        </span>
      </div>
    );
  }

  const hasDetail =
    step.input !== null || step.output !== null || step.detail !== null;
  const listCount = getListCount(step.output);

  return (
    <div className="border-b border-border/50">
      <button
        type="button"
        className="w-full flex items-center gap-3 py-2 px-3 hover:bg-muted/50 transition-colors text-left"
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
        <span className="text-sm font-medium truncate min-w-0">
          {nodeTitle}
        </span>
        {step.statusReason && (
          <span className="text-xs text-muted-foreground truncate min-w-0">
            {step.statusReason}
          </span>
        )}
        {listCount !== null && (
          <span className="ml-1 text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0">
            {listCount} {listCount === 1 ? t`item` : t`items`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">
            {durationLabel(step.durationMs)}
          </span>
          <StepStatus status={step.status} />
        </div>
      </button>

      {expanded && hasDetail && (
        <div className="px-10 pb-3 space-y-3">
          {step.input !== null && (
            <ExpandedSection label={t`Input`}>
              <RuntimeValueView value={step.input} />
            </ExpandedSection>
          )}
          {step.output !== null && (
            <ExpandedSection label={t`Output`}>
              <RuntimeValueView value={step.output} />
            </ExpandedSection>
          )}
          {step.detail !== null && (
            <ExpandedSection label={t`Why`}>
              <ConditionDetail detail={step.detail} />
            </ExpandedSection>
          )}
        </div>
      )}
    </div>
  );
}

function stepRowFromType(step: WorkflowRunStep) {
  const meta = NODE_KIND_META[step.nodeType as keyof typeof NODE_KIND_META];
  const Icon = meta?.Icon;
  return (
    <StepRow
      key={step.nodeId}
      step={step}
      nodeTitle={meta?.defaultTitle ?? step.nodeType}
      nodeIcon={Icon ? <Icon className="size-3.5" /> : null}
    />
  );
}

export function WorkflowRunSteps({
  steps,
  definition,
  compacted,
  stepsPurged
}: WorkflowRunStepsProps) {
  if (stepsPurged) {
    return (
      <div className="py-6 px-4 text-sm text-muted-foreground text-center">
        <Trans>
          Step detail is kept for 30 days. This run's steps have been removed.
        </Trans>
      </div>
    );
  }

  // Group steps by nodeId, picking the node-level row (itemKey === "")
  const stepsByNode = new Map<string, WorkflowRunStep>();
  for (const step of steps) {
    if (!step.itemKey || step.itemKey === "") {
      stepsByNode.set(step.nodeId, step);
    }
  }

  // If no definition, just show steps in sequence order
  if (!definition) {
    const sorted = [...steps]
      .filter((s) => !s.itemKey || s.itemKey === "")
      .sort((a, b) => a.sequence - b.sequence);
    return (
      <div className="divide-y-0">
        {sorted.map((step) => stepRowFromType(step))}
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
      <div>
        {order.map((nodeId) => {
          const node = nodeMap.get(nodeId);
          if (!node) return null;
          const meta = NODE_KIND_META[node.type];
          const Icon = meta.Icon;
          const step = stepsByNode.get(nodeId) ?? null;
          const nodeTitle =
            ((node.data as Record<string, unknown>).title as
              | string
              | undefined) ??
            meta.title?.(node) ??
            meta.defaultTitle;

          return (
            <StepRow
              key={nodeId}
              step={step}
              nodeTitle={nodeTitle}
              nodeIcon={<Icon className="size-3.5" />}
            />
          );
        })}
        {orphanSteps.map((step) => stepRowFromType(step))}
      </div>
    </div>
  );
}
