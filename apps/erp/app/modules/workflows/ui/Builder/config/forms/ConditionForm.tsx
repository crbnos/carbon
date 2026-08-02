import {
  Alert,
  AlertDescription,
  Button,
  IconButton,
  VStack
} from "@carbon/react";
import type { Clause, ConditionPath } from "@carbon/workflows";
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
import { LuGripVertical, LuInfo, LuPlus, LuX } from "react-icons/lu";
import { useBuilderStore } from "../../context";
import ClauseRow, { CLAUSE_GRID_CLASS } from "../ClauseRow";
import { CombinatorToggle } from "../CombinatorToggle";
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
  onCombinatorChange
}: SortableClauseItemProps) {
  const { t } = useLingui();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: sortId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  const grip = (
    <button
      type="button"
      aria-label={t`Drag to reorder`}
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
      />
      {!isLast && (
        <div className="flex justify-center py-1">
          <CombinatorToggle value={combinator} onChange={onCombinatorChange} />
        </div>
      )}
    </div>
  );
}

const KIND_PILL: Record<ConditionPath["kind"], string> = {
  if: "If",
  elseIf: "Else if",
  else: "Else"
};

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

  // Positional index for if/elseIf paths
  function pathIndex(pathId: string): number {
    return paths
      .filter((p) => p.kind !== "else")
      .findIndex((p) => p.id === pathId);
  }

  const context = { nodeId: node.id, inLoop: false };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  return (
    <VStack spacing={4}>
      <Alert>
        <LuInfo />
        <AlertDescription>
          <Trans>
            This step chooses which path runs next — it doesn't produce values
            of its own. Reference earlier steps further down each path.
          </Trans>
        </AlertDescription>
      </Alert>

      {paths.map((path) => {
        const isElse = path.kind === "else";
        const isIf = path.kind === "if";
        const idx = isElse ? null : pathIndex(path.id);
        const posLabel = isElse ? t`Path else` : t`Path ${idx}`;

        return (
          <div key={path.id} className="space-y-1">
            {/* Semantic kind pill — outside the bordered block */}
            <div className="flex items-center justify-between">
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {KIND_PILL[path.kind]}
              </span>
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

            {/* Bordered block */}
            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {posLabel}
                </span>
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
                  >
                    <Trans>Add clause</Trans>
                  </Button>
                )}
              </div>

              {isElse ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Connect the Otherwise handle to a node to run when no
                    condition matches.
                  </Trans>
                </p>
              ) : (
                <>
                  {/* Column headers */}
                  {path.clauses.length > 0 && (
                    <div className={CLAUSE_GRID_CLASS}>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground pl-3">
                        <Trans>Input</Trans>
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Trans>Operator</Trans>
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Trans>Value</Trans>
                      </span>
                    </div>
                  )}

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
                        />
                      ))}
                    </SortableContext>
                  </DndContext>

                  {path.clauses.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      <Trans>No clauses yet. Add one above.</Trans>
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
        >
          <Trans>Add otherwise</Trans>
        </Button>
      )}
    </VStack>
  );
}
