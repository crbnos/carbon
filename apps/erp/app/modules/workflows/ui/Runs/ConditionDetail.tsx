import { OPERATOR_LABELS } from "@carbon/utils";
import type {
  Clause,
  ClauseEvaluation,
  ConditionNode,
  NodeDetail
} from "@carbon/workflows";
import { Trans } from "@lingui/react/macro";
import { LuCheck, LuX } from "react-icons/lu";
import { humanizeField } from "../Builder/nodes/meta";
import { RuntimeValueView } from "./RuntimeValueView";

function pathLabel(index: number, hasEvaluations: boolean): string {
  if (!hasEvaluations) return "Else";
  if (index === 0) return "If";
  return "Else if";
}

/** Names the left-hand side of a comparison; `detail` only stores its value. */
function leftLabel(clause: Clause | undefined): string | undefined {
  if (!clause) return undefined;
  const { left } = clause;
  if (left.kind === "ref") {
    const last = left.path[left.path.length - 1];
    return last ? humanizeField(last) : humanizeField(left.output);
  }
  if (left.kind === "item") return "This item";
  return undefined;
}

function ClauseLine({
  evaluation,
  combinator,
  showCombinator,
  label
}: {
  evaluation: ClauseEvaluation;
  combinator: string;
  showCombinator: boolean;
  label?: string;
}) {
  return (
    <div className="space-y-1">
      {showCombinator && (
        <div className="text-xs text-muted-foreground uppercase font-medium py-0.5">
          {combinator}
        </div>
      )}
      <div className="flex items-start gap-2 flex-wrap text-sm">
        {label && <span className="font-medium">{label}</span>}
        <span className="min-w-0 shrink">
          <RuntimeValueView value={evaluation.left} />
        </span>
        <span className="text-muted-foreground self-center">
          {OPERATOR_LABELS[evaluation.operator] ?? evaluation.operator}
        </span>
        <span className="min-w-0 shrink">
          <RuntimeValueView value={evaluation.right} />
        </span>
        <span className="self-center ml-auto">
          {evaluation.passed === null ? (
            <span className="text-xs text-muted-foreground">
              {evaluation.reason ?? "—"}
            </span>
          ) : evaluation.passed ? (
            <LuCheck className="size-3.5 text-emerald-600" />
          ) : (
            <LuX className="size-3.5 text-destructive" />
          )}
        </span>
      </div>
    </div>
  );
}

export function ConditionDetail({
  detail,
  node
}: {
  detail: unknown;
  node?: ConditionNode;
}) {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (d.kind !== "condition") return null;

  const paths = d.paths as NodeDetail["paths"];
  if (!Array.isArray(paths) || paths.length === 0) return null;

  return (
    <div className="space-y-3">
      {paths.map((pathEntry, pathIndex) => {
        const defPath = node?.data.paths.find((p) => p.id === pathEntry.pathId);
        return (
          <div key={pathEntry.pathId} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {pathLabel(pathIndex, pathEntry.evaluations.length > 0)}
              </span>
              {pathEntry.taken && (
                <span className="text-xs text-emerald-600 font-medium">
                  <Trans>taken</Trans>
                </span>
              )}
            </div>
            {pathEntry.evaluations.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                <Trans>Always taken</Trans>
              </p>
            ) : (
              <div className="space-y-1.5 pl-2 border-l border-border">
                {pathEntry.evaluations.map((ev, i) => (
                  <ClauseLine
                    key={`clause-${i}`}
                    evaluation={ev}
                    combinator={pathEntry.combinator}
                    showCombinator={i > 0}
                    label={leftLabel(defPath?.clauses[i])}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
