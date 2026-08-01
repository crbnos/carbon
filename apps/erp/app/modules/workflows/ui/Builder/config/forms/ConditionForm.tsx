import { Button, cn, IconButton, VStack } from "@carbon/react";
import type { Clause, ConditionPath } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { LuPlus, LuX } from "react-icons/lu";
import { useBuilderStore } from "../../context";
import ClauseRow from "../ClauseRow";
import type { NodeFormProps } from "./index";

const SECTION =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

const newClause = (): Clause => ({
  left: {
    kind: "literal",
    type: { kind: "primitive", of: "string" },
    value: ""
  },
  operator: "eq",
  right: {
    kind: "literal",
    type: { kind: "primitive", of: "string" },
    value: ""
  }
});

export function ConditionForm({ node }: NodeFormProps) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const onEdgesChange = useBuilderStore((s) => s.onEdgesChange);
  const edges = useBuilderStore((s) => s.edges);
  const { t } = useLingui();

  const data = node.data as { paths: ConditionPath[] };
  const paths = (data.paths ?? []) as ConditionPath[];

  const hasElse = paths.some((p) => p.kind === "else");

  function setPaths(next: ConditionPath[]) {
    updateNodeData(node.id, { paths: next });
  }

  function updatePath(pathId: string, patch: Partial<ConditionPath>) {
    setPaths(paths.map((p) => (p.id === pathId ? { ...p, ...patch } : p)));
  }

  function addElseIf() {
    const path: ConditionPath = {
      id: nanoid(),
      kind: "elseIf",
      combinator: "and",
      clauses: []
    };
    const elseIdx = paths.findIndex((p) => p.kind === "else");
    const next = [...paths];
    elseIdx === -1 ? next.push(path) : next.splice(elseIdx, 0, path);
    setPaths(next);
  }

  function addElse() {
    setPaths([
      ...paths,
      { id: nanoid(), kind: "else", combinator: "and", clauses: [] }
    ]);
  }

  function removePath(pathId: string) {
    const affected = edges.filter(
      (e) => e.source === node.id && e.sourceHandle === pathId
    );
    if (affected.length > 0) {
      const count = affected.length;
      if (
        !window.confirm(
          t`Removing this path will also disconnect ${count} connection${count > 1 ? "s" : ""}. Continue?`
        )
      )
        return;
      onEdgesChange(
        affected.map((e) => ({ type: "remove" as const, id: e.id }))
      );
    }
    setPaths(paths.filter((p) => p.id !== pathId));
  }

  function changeClause(pathId: string, index: number, patch: Partial<Clause>) {
    setPaths(
      paths.map((p) =>
        p.id === pathId
          ? {
              ...p,
              clauses: p.clauses.map((c, i) =>
                i === index ? { ...c, ...patch } : c
              )
            }
          : p
      )
    );
  }

  function removeClause(pathId: string, index: number) {
    setPaths(
      paths.map((p) =>
        p.id === pathId
          ? { ...p, clauses: p.clauses.filter((_, i) => i !== index) }
          : p
      )
    );
  }

  const context = { nodeId: node.id, inLoop: false };

  return (
    <VStack spacing={4}>
      {paths.map((path) => {
        const isElse = path.kind === "else";
        const isIf = path.kind === "if";
        const pathLabel = isIf ? t`If` : isElse ? t`Otherwise` : t`Else if`;

        return (
          <div
            key={path.id}
            className="rounded-lg border border-border p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={SECTION}>{pathLabel}</span>

                {!isElse && (
                  <div className="flex overflow-hidden rounded-md border text-xs">
                    <button
                      type="button"
                      className={cn(
                        "px-2 py-1 transition-colors",
                        path.combinator === "and"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      )}
                      onClick={() => updatePath(path.id, { combinator: "and" })}
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "border-l px-2 py-1 transition-colors",
                        path.combinator === "or"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      )}
                      onClick={() => updatePath(path.id, { combinator: "or" })}
                    >
                      OR
                    </button>
                  </div>
                )}
              </div>

              {!isIf && (
                <IconButton
                  icon={<LuX />}
                  aria-label={t`Remove path`}
                  variant="ghost"
                  size="sm"
                  onClick={() => removePath(path.id)}
                />
              )}
            </div>

            {!isElse ? (
              <>
                {path.clauses.map((clause, i) => (
                  <ClauseRow
                    key={i}
                    clause={clause}
                    index={i}
                    canRemove={path.clauses.length > 1}
                    onChange={(idx, patch) => changeClause(path.id, idx, patch)}
                    onRemove={(idx) => removeClause(path.id, idx)}
                    context={context}
                  />
                ))}

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<LuPlus />}
                  onClick={() =>
                    updatePath(path.id, {
                      clauses: [...path.clauses, newClause()]
                    })
                  }
                >
                  <Trans>Add rule</Trans>
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Connect the Otherwise handle to a node to run when no
                  condition matches.
                </Trans>
              </p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<LuPlus />}
          onClick={addElseIf}
        >
          <Trans>Add path</Trans>
        </Button>

        {!hasElse && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<LuPlus />}
            onClick={addElse}
          >
            <Trans>Add otherwise</Trans>
          </Button>
        )}
      </div>
    </VStack>
  );
}
