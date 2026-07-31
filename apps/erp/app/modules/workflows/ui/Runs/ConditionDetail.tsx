import type { ClauseEvaluation, NodeDetail } from "@carbon/workflows";
import { Trans } from "@lingui/react/macro";
import { LuCheck, LuX } from "react-icons/lu";
import { RuntimeValueView } from "./RuntimeValueView";

function pathLabel(index: number, hasEvaluations: boolean): string {
  if (!hasEvaluations) return "Else";
  if (index === 0) return "If";
  return "Else if";
}

function ClauseLine({
  evaluation,
  combinator,
  showCombinator
}: {
  evaluation: ClauseEvaluation;
  combinator: string;
  showCombinator: boolean;
}) {
  return (
    <div className="space-y-1">
      {showCombinator && (
        <div className="text-xs text-muted-foreground uppercase font-medium py-0.5">
          {combinator}
        </div>
      )}
      <div className="flex items-start gap-2 flex-wrap text-sm">
        <span className="min-w-0 shrink">
          <RuntimeValueView value={evaluation.left} />
        </span>
        <span className="text-muted-foreground text-xs self-center">
          {evaluation.operator}
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

export function ConditionDetail({ detail }: { detail: unknown }) {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (d.kind !== "condition") return null;

  const paths = d.paths as NodeDetail["paths"];
  if (!Array.isArray(paths) || paths.length === 0) return null;

  return (
    <div className="space-y-3">
      {paths.map((pathEntry, pathIndex) => (
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
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
