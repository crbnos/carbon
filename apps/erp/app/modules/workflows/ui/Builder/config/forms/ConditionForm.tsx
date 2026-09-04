import { Button, IconButton } from "@carbon/react";
import type { Clause, ConditionPath, WorkflowIssue } from "@carbon/workflows";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { LuGripVertical, LuPlus, LuX } from "react-icons/lu";
import { useBuilderStore } from "../../context";
import { OutputHandle } from "../../OutputHandle";
import { conditionPathLabel } from "../../ports";
import ClauseRow from "../ClauseRow";
import { CombinatorToggle } from "../CombinatorToggle";
import { FormStack } from "../layout";
import type { NodeFormProps } from "./index";

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

type SortableClauseItemProps = {
  sortId: string;
  clause: Clause;
  index: number;
  canRemove: boolean;
  onChange: (index: number, patch: Partial<Clause>) => void;
  onRemove: (index: number) => void;
  context: { nodeId: string; inLoop: boolean };
  combinator: "and" | "or";
  isLast: boolean;
  onCombinatorChange: (v: "and" | "or") => void;
  fieldPath: string;
  issues?: WorkflowIssue[];
  isReadOnly?: boolean;
};

function SortableClauseItem({
  sortId,
  clause,
  index,
  canRemove,
  onChange,
  onRemove,
  context,
  combinator,
  isLast,
  onCombinatorChange,
  fieldPath,
  issues,
  isReadOnly
}: SortableClauseItemProps) {
  const { t } = useLingui();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: sortId, disabled: isReadOnly });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  const grip = (
    <button
      type="button"
      aria-label={t`Drag to reorder`}
      disabled={isReadOnly}
      className="nodrag nopan flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <LuGripVertical className="size-3.5" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      <ClauseRow
        clause={clause}
        index={index}
        canRemove={canRemove}
        onChange={onChange}
        onRemove={onRemove}
        context={context}
        grip={grip}
        fieldPath={fieldPath}
        issues={issues}
        isReadOnly={isReadOnly}
      />
      {!isLast && (
        <div className="flex justify-center py-3">
          <CombinatorToggle
            value={combinator}
            onChange={onCombinatorChange}
            isReadOnly={isReadOnly}
          />
        </div>
      )}
    </div>
  );
}

export function ConditionForm({
  node,
  issues,
  isReadOnly
}: NodeFormProps<"condition">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const onEdgesChange = useBuilderStore((s) => s.onEdgesChange);
  const edges = useBuilderStore((s) => s.edges);
  const { t } = useLingui();

  const { paths } = node.data;

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  return (
    <FormStack spacing={4}>
      {paths.map((path) => {
        const isElse = path.kind === "else";
        const isIf = path.kind === "if";
        const kindLabel = conditionPathLabel(paths, path.id, t);

        return (
          // Full-bleed + `relative` centres the handle on the whole block (pill and
          // box). `gap` not `space-y`, or the absolute handle would gain a margin.
          <div
            key={path.id}
            className="relative -mx-2.5 flex flex-col gap-1 px-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                {kindLabel}
              </span>
              <div className="flex items-center gap-0.5">
                {!isElse && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<LuPlus />}
                    onClick={() =>
                      updatePath(path.id, {
                        clauses: [...path.clauses, newClause()]
                      })
                    }
                    isDisabled={isReadOnly}
                  >
                    <Trans>Add clause</Trans>
                  </Button>
                )}
                {!isIf && (
                  <IconButton
                    icon={<LuX />}
                    aria-label={t`Remove path`}
                    variant="ghost"
                    size="sm"
                    onClick={() => removePath(path.id)}
                    isDisabled={isReadOnly}
                  />
                )}
              </div>
            </div>
            {/* Centres on the whole block because the wrapper above is `relative`
                and full-bleed, so the handle lands on the card's border. */}
            <OutputHandle
              nodeId={node.id}
              port={{
                id: path.id,
                label: kindLabel,
                tone: "default",
                anchor: "inline"
              }}
            />

            <div className="rounded-md border border-border bg-muted/30 p-2.5">
              {isElse ? (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Connect the Otherwise handle to a node to run when no
                    condition matches.
                  </Trans>
                </p>
              ) : (
                <>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event) => {
                      const { active, over } = event;
                      if (!over || active.id === over.id) return;
                      const from = Number(active.id);
                      const to = Number(over.id);
                      updatePath(path.id, {
                        clauses: arrayMove(path.clauses, from, to)
                      });
                    }}
                  >
                    <SortableContext
                      items={path.clauses.map((_, i) => String(i))}
                      strategy={verticalListSortingStrategy}
                    >
                      {path.clauses.map((clause, i) => (
                        <SortableClauseItem
                          key={i}
                          sortId={String(i)}
                          clause={clause}
                          index={i}
                          canRemove={path.clauses.length > 1}
                          onChange={(idx, patch) =>
                            changeClause(path.id, idx, patch)
                          }
                          onRemove={(idx) => removeClause(path.id, idx)}
                          context={context}
                          combinator={path.combinator ?? "and"}
                          isLast={i === path.clauses.length - 1}
                          onCombinatorChange={(v) =>
                            updatePath(path.id, { combinator: v })
                          }
                          fieldPath={`paths.${path.id}.clauses.${i}`}
                          issues={issues}
                          isReadOnly={isReadOnly}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>

                  {path.clauses.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      <Trans>No clauses yet. Use Add clause above.</Trans>
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={<LuPlus />}
        className="w-full"
        onClick={addElseIf}
        isDisabled={isReadOnly}
      >
        <Trans>Add path</Trans>
      </Button>

      {!hasElse && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<LuPlus />}
          className="w-full"
          onClick={addElse}
          isDisabled={isReadOnly}
        >
          <Trans>Add otherwise</Trans>
        </Button>
      )}
    </FormStack>
  );
}
