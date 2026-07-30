import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import type { AssemblyGraphIndex, ComponentGroup } from "@carbon/viewer";
import { describeStep, groupComponentNodeIds } from "@carbon/viewer";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowDownAZ,
  LuArrowDownWideNarrow,
  LuBlocks,
  LuChevronDown,
  LuChevronRight,
  LuCirclePlus,
  LuEye,
  LuEyeOff,
  LuListPlus,
  LuListX,
  LuMerge,
  LuPencil,
  LuSearch,
  LuSettings,
  LuTrash,
  LuX
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { FlattenedBomMaterial } from "../../production.service";
import { toViewerStep } from "../../production.service";
import type {
  AssemblyComponentMapping,
  AssemblyInstructionStepRow,
  AssemblyUnit
} from "../../types";
import { ComponentColorSwatch } from "./AssemblyStepBom";

type SortMode = "count" | "alpha";

/** The distinct component types inside a subassembly, with the member instances of each. */
type UnitChild = { group: ComponentGroup; nodeIds: string[] };

/**
 * One rendered row: a subassembly (virtual component) and its expanded member
 * components, or a component group and its expanded instances. Subassemblies and multi-quantity
 * groups both expand the same way.
 */
type ListRow =
  | { type: "unit"; unit: AssemblyUnit; children: UnitChild[] }
  | {
      type: "unitChild";
      unit: AssemblyUnit;
      group: ComponentGroup;
      nodeIds: string[];
    }
  | { type: "group"; group: ComponentGroup }
  | {
      type: "instance";
      group: ComponentGroup;
      nodeId: string;
      instanceIndex: number;
    };

/** The instance nodeIds a row represents (all of them for a group/unit row). */
function rowNodeIds(row: ListRow): string[] {
  switch (row.type) {
    case "unit":
      return row.unit.componentNodeIds ?? [];
    case "unitChild":
      return row.nodeIds;
    case "group":
      return row.group.nodeIds;
    case "instance":
      return [row.nodeId];
  }
}

type SelectionState = "none" | "partial" | "all";

function selectionStateOf(
  nodeIds: string[],
  selected: ReadonlySet<string>
): SelectionState {
  let count = 0;
  for (const id of nodeIds) if (selected.has(id)) count++;
  if (count === 0) return "none";
  return count === nodeIds.length ? "all" : "partial";
}

type AssemblyBomTreeProps = {
  graphIndex: AssemblyGraphIndex | null;
  steps: AssemblyInstructionStepRow[];
  units: AssemblyUnit[];
  isDisabled: boolean;
  modelUploadId: string | null;
  componentMappings: AssemblyComponentMapping[];
  bomMaterials: FlattenedBomMaterial[];
  /** Current selection (shared with the viewer) — marks + scrolls to the rows */
  selectedNodeIds: string[];
  /** The Components tab is the visible tab — gate scroll-to-selection on it */
  isActive: boolean;
  /** A new-step create is in flight — disables the Add Step action */
  isAddingStep: boolean;
  onHighlightComponents: (nodeIds: string[]) => void;
  onHideComponents: (nodeIds: string[]) => void;
  onSelectStep: (stepId: string) => void;
  /** Create a step seeded with the current selection (shared with the parent) */
  onAddStep: () => void;
};

/**
 * Bill of materials derived from the model's assembly graph: every distinct
 * component with its instance count, plus authored subassembly units — sets of
 * components the planner treats as one rigid body (overriding the automatic
 * BOM-driven derivation). Selecting rows highlights all instances in the viewer;
 * a selection can be planned as one component via the toolbar or right-click menu.
 * Components map to engineering BOM items (methodMaterial) by geometry hash —
 * auto-matched by name/quantity, adjustable per component in the detail popover.
 */
export default function AssemblyBomTree({
  graphIndex,
  steps,
  units,
  isDisabled,
  modelUploadId,
  componentMappings,
  bomMaterials,
  selectedNodeIds,
  isActive,
  isAddingStep,
  onHighlightComponents,
  onHideComponents,
  onSelectStep,
  onAddStep
}: AssemblyBomTreeProps) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();
  const canGroup = !isDisabled && permissions.can("create", "production");
  const canAddStep = !isDisabled && permissions.can("update", "production");
  const canMap =
    !isDisabled &&
    permissions.can("update", "production") &&
    Boolean(modelUploadId);

  const autoMatchFetcher = useFetcher<{ success: boolean }>();
  const mappingsByHash = useMemo(
    () =>
      new Map(
        componentMappings.map((mapping) => [mapping.geometryHash, mapping])
      ),
    [componentMappings]
  );

  // itemId → BOM line, so each ComponentRow resolves its mapped line in O(1)
  // instead of a linear scan of every BOM material per row per render.
  const bomByItemId = useMemo(
    () => new Map(bomMaterials.map((material) => [material.itemId, material])),
    [bomMaterials]
  );

  const [sortMode, setSortMode] = useState<SortMode>("count");
  const [search, setSearch] = useState("");
  // Selection and visibility are tracked per instance (nodeId), so a group with
  // several instances can be partly selected or hidden — e.g. 2 of 4 screws.
  // Selection round-trips through the parent (shared with the viewer).
  const selectedSet = useMemo(
    () => new Set(selectedNodeIds),
    [selectedNodeIds]
  );
  const [hiddenNodeIds, setHiddenNodeIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [showCreateUnit, setShowCreateUnit] = useState(false);
  const [editingUnit, setEditingUnit] = useState<AssemblyUnit | null>(null);
  const lastClickedIndexRef = useRef<number | null>(null);

  // Every instance that belongs to a subassembly — those show under the
  // subassembly, so they're dropped from the flat list to avoid double-listing.
  const unitMemberSet = useMemo(() => {
    const set = new Set<string>();
    for (const unit of units) {
      for (const nodeId of unit.componentNodeIds ?? []) set.add(nodeId);
    }
    return set;
  }, [units]);

  const componentGroups = useMemo(() => {
    if (!graphIndex) return [];
    // Keep only the instances of each component that aren't inside a subassembly.
    // A component half in a subassembly still lists its loose instances (with the
    // reduced count); a component fully consumed by subassemblies drops out.
    const groups: ComponentGroup[] = [];
    for (const group of graphIndex.groups) {
      const nodeIds =
        unitMemberSet.size === 0
          ? group.nodeIds
          : group.nodeIds.filter((nodeId) => !unitMemberSet.has(nodeId));
      if (nodeIds.length === 0) continue;
      groups.push(
        nodeIds.length === group.nodeIds.length
          ? group
          : { ...group, nodeIds, count: nodeIds.length }
      );
    }
    // Every mode falls back to alphabetical: count sorts by instance count then
    // by name so equal-count components stay A→Z, and alpha is pure name order.
    if (sortMode === "count") {
      groups.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    } else {
      groups.sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }, [graphIndex, sortMode, unitMemberSet]);

  // Name filter for the rendered list. Selection/hiding still operate on the
  // full `componentGroups` (they key by group, not display position); only the rows
  // shown, the shift-click range, and scroll-to-selection use `rows`.
  const normalizedSearch = search.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!normalizedSearch) return componentGroups;
    return componentGroups.filter((group) =>
      group.name.toLowerCase().includes(normalizedSearch)
    );
  }, [componentGroups, normalizedSearch]);

  // A step whose components are exactly a subassembly unit is titled by its name.
  const namedUnits = useMemo(
    () =>
      units.map((unit) => ({
        name: unit.name,
        componentNodeIds: unit.componentNodeIds ?? []
      })),
    [units]
  );

  /** groupKey → steps that install instances of the component */
  const stepUsage = useMemo(() => {
    const usage = new Map<
      string,
      { stepId: string; index: number; title: string }[]
    >();
    if (!graphIndex) return usage;
    steps.forEach((step, index) => {
      const seen = new Set<string>();
      for (const nodeId of step.componentNodeIds ?? []) {
        const group = graphIndex.groupByNodeId.get(nodeId);
        if (!group || seen.has(group.key)) continue;
        seen.add(group.key);
        const entry = usage.get(group.key) ?? [];
        entry.push({
          stepId: step.id,
          index,
          title:
            describeStep(toViewerStep(step), graphIndex, namedUnits) ??
            "Untitled step"
        });
        usage.set(group.key, entry);
      }
    });
    return usage;
  }, [steps, graphIndex, namedUnits]);

  // A subassembly's member instances, grouped by component type — so it expands
  // into "Screw ×4 / Board ×1" child rows the same way a multi-quantity component does.
  const unitChildren = useMemo(() => {
    const map = new Map<string, UnitChild[]>();
    if (!graphIndex) return map;
    for (const unit of units) {
      const byGroup = new Map<string, UnitChild>();
      for (const nodeId of unit.componentNodeIds ?? []) {
        const group = graphIndex.groupByNodeId.get(nodeId);
        if (!group) continue;
        const existing = byGroup.get(group.key);
        if (existing) existing.nodeIds.push(nodeId);
        else byGroup.set(group.key, { group, nodeIds: [nodeId] });
      }
      map.set(
        unit.id,
        [...byGroup.values()].sort((a, b) =>
          a.group.name.localeCompare(b.group.name)
        )
      );
    }
    return map;
  }, [units, graphIndex]);

  const visibleUnits = useMemo(() => {
    const filtered = normalizedSearch
      ? units.filter((unit) =>
          unit.name.toLowerCase().includes(normalizedSearch)
        )
      : units;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [units, normalizedSearch]);

  // Flatten subassemblies and component groups (each with their expanded children)
  // into the virtualized list. Subassemblies lead — they're the higher-level
  // grouping — and expand into their member components; a component group with count > 1
  // expands into one row per instance. Either way a subset can be selected or
  // hidden individually.
  const visualRows = useMemo<ListRow[]>(() => {
    const list: ListRow[] = [];
    for (const unit of visibleUnits) {
      const children = unitChildren.get(unit.id) ?? [];
      list.push({ type: "unit", unit, children });
      if (expandedKeys.has(`unit:${unit.id}`)) {
        for (const child of children) {
          list.push({
            type: "unitChild",
            unit,
            group: child.group,
            nodeIds: child.nodeIds
          });
        }
      }
    }
    for (const group of rows) {
      list.push({ type: "group", group });
      if (group.count > 1 && expandedKeys.has(group.key)) {
        group.nodeIds.forEach((nodeId, instanceIndex) => {
          list.push({ type: "instance", group, nodeId, instanceIndex });
        });
      }
    }
    return list;
  }, [rows, expandedKeys, visibleUnits, unitChildren]);

  const hasSelection = selectedNodeIds.length > 0;

  // Assign the current selection to an existing step. `move` strips it from the
  // steps it's already on; `duplicate` leaves those. When the selection is
  // already used elsewhere we ask which — otherwise assign straight away.
  const reassignFetcher = useFetcher<{ success: boolean }>();
  const [assignPickerOpen, setAssignPickerOpen] = useState(false);
  const [pendingAssign, setPendingAssign] = useState<{
    targetStepId: string;
    targetTitle: string;
    conflictTitles: string[];
  } | null>(null);

  const stepList = useMemo(
    () =>
      steps.map((step, index) => ({
        id: step.id,
        index,
        title:
          describeStep(toViewerStep(step), graphIndex, namedUnits) ??
          step.title ??
          "Untitled step"
      })),
    [steps, graphIndex, namedUnits]
  );

  const submitAssign = useCallback(
    (targetStepId: string, mode: "move" | "duplicate") => {
      const formData = new FormData();
      formData.set("targetStepId", targetStepId);
      formData.set("componentNodeIds", JSON.stringify(selectedNodeIds));
      formData.set("mode", mode);
      reassignFetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepComponentsReassign(id)
      });
    },
    [reassignFetcher, id, selectedNodeIds]
  );

  // Unassign the selection from every step (no target). Enabled only when the
  // selection is actually installed on some step.
  const selectionOnSomeStep = useMemo(
    () =>
      steps.some((step) =>
        (step.componentNodeIds ?? []).some((nodeId) => selectedSet.has(nodeId))
      ),
    [steps, selectedSet]
  );
  const submitRemove = useCallback(() => {
    setAssignPickerOpen(false);
    const formData = new FormData();
    formData.set("componentNodeIds", JSON.stringify(selectedNodeIds));
    formData.set("mode", "remove");
    reassignFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstructionStepComponentsReassign(id)
    });
  }, [reassignFetcher, id, selectedNodeIds]);

  const onPickAssignStep = useCallback(
    (targetStepId: string) => {
      setAssignPickerOpen(false);
      // Steps (other than the target) that already install any selected instance.
      const conflictTitles = stepList
        .filter(
          (entry) =>
            entry.id !== targetStepId &&
            (steps
              .find((step) => step.id === entry.id)
              ?.componentNodeIds?.some((nodeId) => selectedSet.has(nodeId)) ??
              false)
        )
        .map((entry) => `${entry.index + 1}. ${entry.title}`);
      if (conflictTitles.length === 0) {
        // Not on any other step — nothing to move, just add it here.
        submitAssign(targetStepId, "duplicate");
        return;
      }
      setPendingAssign({
        targetStepId,
        targetTitle:
          stepList.find((entry) => entry.id === targetStepId)?.title ??
          "this step",
        conflictTitles
      });
    },
    [stepList, steps, selectedSet, submitAssign]
  );

  // Push the hidden instance set up to the viewer.
  useEffect(() => {
    onHideComponents([...hiddenNodeIds]);
  }, [hiddenNodeIds, onHideComponents]);

  const applyNodeSelection = (next: ReadonlySet<string>) => {
    onHighlightComponents([...next]);
  };

  const onRowClick = (event: MouseEvent, rowIndex: number) => {
    const row = visualRows[rowIndex];
    if (!row) return;
    const rowNodes = rowNodeIds(row);
    let next: Set<string>;
    if (event.shiftKey && lastClickedIndexRef.current !== null) {
      next = new Set(selectedNodeIds);
      const start = Math.min(lastClickedIndexRef.current, rowIndex);
      const end = Math.max(lastClickedIndexRef.current, rowIndex);
      for (let i = start; i <= end; i++) {
        const inRange = visualRows[i];
        if (inRange) for (const id of rowNodeIds(inRange)) next.add(id);
      }
    } else if (event.metaKey || event.ctrlKey) {
      next = new Set(selectedNodeIds);
      const allSelected = rowNodes.every((id) => next.has(id));
      for (const id of rowNodes) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
    } else {
      // Plain click selects just this row; clicking it when it is already the
      // entire selection clears it.
      const isOnlySelection =
        selectedNodeIds.length === rowNodes.length &&
        rowNodes.every((id) => selectedSet.has(id));
      next = isOnlySelection ? new Set() : new Set(rowNodes);
    }
    lastClickedIndexRef.current = rowIndex;
    applyNodeSelection(next);
  };

  const onToggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onHideSelection = () => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      for (const id of selectedNodeIds) next.add(id);
      return next;
    });
    applyNodeSelection(new Set());
  };

  // Toggle visibility of a set of instances (a whole group, or one instance).
  // A group hides unless every instance is already hidden, in which case it
  // reveals them (Onshape-style per-row eye).
  const onToggleHide = (nodeIds: string[]) => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      const allHidden = nodeIds.every((id) => next.has(id));
      for (const id of nodeIds) {
        if (allHidden) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const onShowAll = () => setHiddenNodeIds(new Set());

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visualRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12
  });

  // Bring the current selection into view — when it changes while the Components tab
  // is open, and when the tab becomes active with a selection already present.
  // The scroll container has no dimensions while the tab is hidden, so gate on
  // isActive and defer a frame so the just-shown list can measure.
  const firstSelectedIndex = useMemo(
    () =>
      visualRows.findIndex((row) =>
        rowNodeIds(row).some((id) => selectedSet.has(id))
      ),
    [visualRows, selectedSet]
  );
  useEffect(() => {
    if (!isActive || firstSelectedIndex < 0) return;
    const frame = requestAnimationFrame(() =>
      virtualizer.scrollToIndex(firstSelectedIndex, { align: "center" })
    );
    return () => cancelAnimationFrame(frame);
  }, [isActive, firstSelectedIndex, virtualizer]);

  if (!graphIndex) {
    return (
      <Empty className="border-none">
        <p className="text-sm text-muted-foreground max-w-[280px] text-center">
          The bill of materials appears here once the model loads
        </p>
      </Empty>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex w-full flex-none items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground tabular-nums">
          {hasSelection
            ? `${selectedNodeIds.length} selected`
            : bomMaterials.length > 0
              ? `${componentGroups.length} components · ${mappingsByHash.size} mapped to BOM`
              : `${componentGroups.length} component${componentGroups.length === 1 ? "" : "s"} · ${graphIndex.graph.componentCount} instance${graphIndex.graph.componentCount === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-1">
          {!hasSelection && canMap && bomMaterials.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={autoMatchFetcher.state !== "idle"}
                  isLoading={autoMatchFetcher.state !== "idle"}
                  onClick={() => {
                    autoMatchFetcher.submit(new FormData(), {
                      method: "post",
                      action: path.to.autoMatchAssemblyComponents(id)
                    });
                  }}
                >
                  Match BOM
                </Button>
              </TooltipTrigger>
              <TooltipContent>Match components to BOM items</TooltipContent>
            </Tooltip>
          )}
          {hasSelection && canAddStep && stepList.length > 0 && (
            <Popover open={assignPickerOpen} onOpenChange={setAssignPickerOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <IconButton
                      aria-label="Add selection to a step"
                      icon={<LuListPlus />}
                      variant="ghost"
                      size="sm"
                      isDisabled={reassignFetcher.state !== "idle"}
                    />
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Add to step</TooltipContent>
              </Tooltip>
              <PopoverContent
                align="end"
                className="w-64 p-1"
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
              >
                <p className="px-2 py-1.5 text-xxs font-medium uppercase tracking-wide text-muted-foreground">
                  Add {selectedNodeIds.length} to step
                </p>
                <ul className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
                  {stepList.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                        title={entry.title}
                        onClick={() => onPickAssignStep(entry.id)}
                      >
                        <span className="text-muted-foreground tabular-nums">
                          {entry.index + 1}.
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {entry.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {selectionOnSomeStep && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                      onClick={submitRemove}
                    >
                      <LuListX className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        Remove from steps
                      </span>
                    </button>
                  </>
                )}
              </PopoverContent>
            </Popover>
          )}
          {hasSelection && canGroup && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label="Plan as one component"
                  icon={<LuMerge />}
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateUnit(true)}
                />
              </TooltipTrigger>
              <TooltipContent>Plan as one component</TooltipContent>
            </Tooltip>
          )}
          {hasSelection && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label="Hide selected components"
                  icon={<LuEyeOff />}
                  variant="ghost"
                  size="sm"
                  onClick={onHideSelection}
                />
              </TooltipTrigger>
              <TooltipContent>Hide selected components</TooltipContent>
            </Tooltip>
          )}
          {hiddenNodeIds.size > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label="Show all hidden components"
                  icon={<LuEye />}
                  variant="ghost"
                  size="sm"
                  onClick={onShowAll}
                />
              </TooltipTrigger>
              <TooltipContent>Show all hidden components</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                aria-label={
                  sortMode === "count" ? "Sort alphabetically" : "Sort by count"
                }
                icon={
                  sortMode === "count" ? (
                    <LuArrowDownWideNarrow />
                  ) : (
                    <LuArrowDownAZ />
                  )
                }
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSortMode((mode) => (mode === "count" ? "alpha" : "count"))
                }
              />
            </TooltipTrigger>
            <TooltipContent>
              {sortMode === "count" ? "Sort alphabetically" : "Sort by count"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {componentGroups.length > 0 && (
        <div className="relative w-full flex-none border-b border-border px-2 py-1.5">
          <LuSearch className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search components"
            placeholder="Search components"
            size="sm"
            className="pl-7"
            value={search}
            onChange={(searchEvent) => setSearch(searchEvent.target.value)}
          />
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={parentRef}
            className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
            onKeyDown={(event) => {
              if (event.key === "Escape" && hasSelection) {
                applyNodeSelection(new Set());
              }
            }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = visualRows[virtualRow.index];
                if (!row) return null;
                const style: React.CSSProperties = {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`
                };
                const nodes = rowNodeIds(row);
                if (row.type === "unit") {
                  return (
                    <UnitListRow
                      key={`unit-${row.unit.id}`}
                      unit={row.unit}
                      memberCount={nodes.length}
                      isExpandable={row.children.length > 0}
                      isExpanded={expandedKeys.has(`unit:${row.unit.id}`)}
                      selection={selectionStateOf(nodes, selectedSet)}
                      hidden={selectionStateOf(nodes, hiddenNodeIds)}
                      isDisabled={isDisabled}
                      instructionId={id}
                      style={style}
                      onClick={(event) => onRowClick(event, virtualRow.index)}
                      onToggleHide={() => onToggleHide(nodes)}
                      onToggleExpand={() =>
                        onToggleExpand(`unit:${row.unit.id}`)
                      }
                      onEdit={() => setEditingUnit(row.unit)}
                    />
                  );
                }
                if (row.type === "unitChild") {
                  return (
                    <UnitChildRow
                      key={`unitchild-${row.unit.id}-${row.group.key}`}
                      group={row.group}
                      count={row.nodeIds.length}
                      selection={selectionStateOf(nodes, selectedSet)}
                      hidden={selectionStateOf(nodes, hiddenNodeIds)}
                      style={style}
                      onClick={(event) => onRowClick(event, virtualRow.index)}
                      onToggleHide={() => onToggleHide(nodes)}
                    />
                  );
                }
                if (row.type === "instance") {
                  return (
                    <InstanceRow
                      key={row.nodeId}
                      group={row.group}
                      instanceIndex={row.instanceIndex}
                      isSelected={selectedSet.has(row.nodeId)}
                      isHidden={hiddenNodeIds.has(row.nodeId)}
                      style={style}
                      onClick={(event) => onRowClick(event, virtualRow.index)}
                      onToggleHide={() => onToggleHide(nodes)}
                    />
                  );
                }
                const group = row.group;
                return (
                  <ComponentRow
                    key={group.key}
                    group={group}
                    selection={selectionStateOf(nodes, selectedSet)}
                    hidden={selectionStateOf(nodes, hiddenNodeIds)}
                    isExpanded={expandedKeys.has(group.key)}
                    usage={stepUsage.get(group.key) ?? []}
                    mapping={mappingsByHash.get(group.key) ?? null}
                    bomMaterials={bomMaterials}
                    bomByItemId={bomByItemId}
                    canMap={canMap}
                    modelUploadId={modelUploadId}
                    instructionId={id}
                    style={style}
                    onClick={(event) => onRowClick(event, virtualRow.index)}
                    onToggleHide={() => onToggleHide(nodes)}
                    onToggleExpand={() => onToggleExpand(group.key)}
                    onSelectStep={onSelectStep}
                  />
                );
              })}
            </div>
            {rows.length === 0 &&
              visibleUnits.length === 0 &&
              normalizedSearch && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No components match “{search.trim()}”
                </p>
              )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={!canAddStep || !hasSelection || isAddingStep}
            onClick={onAddStep}
          >
            <LuCirclePlus className="mr-2 h-4 w-4" />
            Add step
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!canGroup || !hasSelection}
            onClick={() => setShowCreateUnit(true)}
          >
            <LuMerge className="mr-2 h-4 w-4" />
            Plan as one component
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!hasSelection} onClick={onHideSelection}>
            <LuEyeOff className="mr-2 h-4 w-4" />
            Hide selected components
          </ContextMenuItem>
          <ContextMenuItem
            disabled={hiddenNodeIds.size === 0}
            onClick={onShowAll}
          >
            <LuEye className="mr-2 h-4 w-4" />
            Show all hidden components
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasSelection}
            onClick={() => applyNodeSelection(new Set())}
          >
            Clear selection
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {canAddStep && (
        <div className="w-full flex-none border-t border-border p-4">
          <Button
            className="w-full"
            variant="secondary"
            leftIcon={<LuCirclePlus />}
            isDisabled={isAddingStep}
            isLoading={isAddingStep}
            onClick={onAddStep}
          >
            Add Step
          </Button>
        </div>
      )}
      {showCreateUnit && modelUploadId && (
        <CreateUnitModal
          instructionId={id}
          modelUploadId={modelUploadId}
          componentNodeIds={selectedNodeIds}
          onClose={() => setShowCreateUnit(false)}
          onCreated={() => {
            setShowCreateUnit(false);
            applyNodeSelection(new Set());
          }}
        />
      )}
      {editingUnit && modelUploadId && (
        <EditUnitModal
          instructionId={id}
          modelUploadId={modelUploadId}
          unit={editingUnit}
          graphIndex={graphIndex}
          selectedNodeIds={selectedNodeIds}
          onClose={() => setEditingUnit(null)}
          onUpdated={() => {
            setEditingUnit(null);
            toast.success(
              "Subassembly updated — re-run motion planning to apply the change"
            );
          }}
        />
      )}
      {pendingAssign && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setPendingAssign(null);
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Move or add a copy?</ModalTitle>
              <ModalDescription>
                {selectedNodeIds.length} component
                {selectedNodeIds.length === 1 ? " is" : "s are"} already used in{" "}
                {pendingAssign.conflictTitles.join(", ")}. Move{" "}
                {selectedNodeIds.length === 1 ? "it" : "them"} to{" "}
                {pendingAssign.targetTitle}, or keep a copy on both?
              </ModalDescription>
            </ModalHeader>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setPendingAssign(null)}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                isDisabled={reassignFetcher.state !== "idle"}
                onClick={() => {
                  submitAssign(pendingAssign.targetStepId, "duplicate");
                  setPendingAssign(null);
                }}
              >
                Add a copy
              </Button>
              <Button
                isDisabled={reassignFetcher.state !== "idle"}
                onClick={() => {
                  submitAssign(pendingAssign.targetStepId, "move");
                  setPendingAssign(null);
                }}
              >
                Move here
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </div>
  );
}

/**
 * A subassembly as a virtual component row: click selects its members (red in the
 * viewer), the chevron expands it into its member component types (UnitChildRow),
 * and it carries the same hide / edit / delete affordances as the old section.
 */
function UnitListRow({
  unit,
  memberCount,
  isExpandable,
  isExpanded,
  selection,
  hidden,
  isDisabled,
  instructionId,
  style,
  onClick,
  onToggleHide,
  onToggleExpand,
  onEdit
}: {
  unit: AssemblyUnit;
  memberCount: number;
  isExpandable: boolean;
  isExpanded: boolean;
  selection: SelectionState;
  hidden: SelectionState;
  isDisabled: boolean;
  instructionId: string;
  style: React.CSSProperties;
  onClick: (event: MouseEvent) => void;
  onToggleHide: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
}) {
  const permissions = usePermissions();
  const deleteFetcher = useFetcher<{ success: boolean }>();
  const canUpdate = !isDisabled && permissions.can("update", "production");
  const canDelete = !isDisabled && permissions.can("delete", "production");
  const allHidden = hidden === "all";

  if (deleteFetcher.state !== "idle") return null;

  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={cn(
        "group relative flex cursor-pointer select-none items-center gap-2 border-b border-border px-3 text-sm hover:bg-accent/30",
        selection === "all" && "bg-blue-500/10 hover:bg-blue-500/10",
        selection === "partial" && "bg-blue-500/5 hover:bg-blue-500/5",
        allHidden && "opacity-50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event as unknown as MouseEvent);
        }
      }}
    >
      {selection !== "none" && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-blue-500",
            selection === "partial" && "opacity-50"
          )}
        />
      )}
      {isExpandable ? (
        <button
          type="button"
          aria-label={
            isExpanded ? `Collapse ${unit.name}` : `Expand ${unit.name}`
          }
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {isExpanded ? (
            <LuChevronDown className="h-3.5 w-3.5" />
          ) : (
            <LuChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden />
      )}
      <LuBlocks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium" title={unit.name}>
        {unit.name}
      </span>
      {unit.sourceGroupId && (
        <Badge
          variant="outline"
          className="text-muted-foreground"
          title="Detected by the motion planner"
        >
          Auto
        </Badge>
      )}
      <Badge variant="secondary" className="tabular-nums">
        ×{memberCount}
      </Badge>
      <div className="flex items-center">
        <IconButton
          aria-label={allHidden ? `Show ${unit.name}` : `Hide ${unit.name}`}
          icon={allHidden ? <LuEyeOff /> : <LuEye />}
          variant="ghost"
          size="sm"
          className={cn(
            "focus:opacity-100",
            hidden !== "none"
              ? "opacity-100 text-muted-foreground"
              : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(event) => {
            event.stopPropagation();
            onToggleHide();
          }}
        />
        {canUpdate && (
          <IconButton
            aria-label={`Edit subassembly ${unit.name}`}
            icon={<LuPencil />}
            variant="ghost"
            size="sm"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          />
        )}
        {canDelete && (
          <IconButton
            aria-label={`Delete subassembly ${unit.name}`}
            icon={<LuTrash />}
            variant="ghost"
            size="sm"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              deleteFetcher.submit(new FormData(), {
                method: "post",
                action: path.to.deleteAssemblyUnit(instructionId, unit.id)
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

/** One member component type inside an expanded subassembly (indented, selectable). */
function UnitChildRow({
  group,
  count,
  selection,
  hidden,
  style,
  onClick,
  onToggleHide
}: {
  group: ComponentGroup;
  count: number;
  selection: SelectionState;
  hidden: SelectionState;
  style: React.CSSProperties;
  onClick: (event: MouseEvent) => void;
  onToggleHide: () => void;
}) {
  const allHidden = hidden === "all";
  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={cn(
        "group relative flex cursor-pointer select-none items-center gap-2 border-b border-border py-1 pl-9 pr-3 text-sm hover:bg-accent/30",
        selection === "all" && "bg-blue-500/10 hover:bg-blue-500/10",
        selection === "partial" && "bg-blue-500/5 hover:bg-blue-500/5",
        allHidden && "opacity-50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event as unknown as MouseEvent);
        }
      }}
    >
      {selection !== "none" && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-blue-500",
            selection === "partial" && "opacity-50"
          )}
        />
      )}
      <ComponentColorSwatch color={group.color} />
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={group.name}
      >
        {group.name}
      </span>
      <Badge variant="secondary" className="tabular-nums">
        ×{count}
      </Badge>
      <IconButton
        aria-label={allHidden ? `Show ${group.name}` : `Hide ${group.name}`}
        icon={allHidden ? <LuEyeOff /> : <LuEye />}
        variant="ghost"
        size="sm"
        className={cn(
          "focus:opacity-100",
          hidden !== "none"
            ? "opacity-100 text-muted-foreground"
            : "opacity-0 group-hover:opacity-100"
        )}
        onClick={(event) => {
          event.stopPropagation();
          onToggleHide();
        }}
      />
    </div>
  );
}

function CreateUnitModal({
  instructionId,
  modelUploadId,
  componentNodeIds,
  onClose,
  onCreated
}: {
  instructionId: string;
  modelUploadId: string;
  componentNodeIds: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const [name, setName] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      onCreated();
    }
  }, [fetcher.state, fetcher.data, onCreated]);

  const onSubmit = () => {
    if (!name.trim()) return;
    const formData = new FormData();
    formData.append("modelUploadId", modelUploadId);
    formData.append("name", name.trim());
    formData.append("componentNodeIds", JSON.stringify(componentNodeIds));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyUnit(instructionId)
    });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Plan as one component</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={3} className="w-full">
            <p className="text-sm text-muted-foreground">
              The planner treats these {componentNodeIds.length} component
              {componentNodeIds.length === 1 ? "" : "s"} as one rigid body — one
              step in the instructions. Re-run the plan to apply.
            </p>
            <Input
              aria-label="Subassembly name"
              placeholder="Subassembly name"
              value={name}
              autoFocus
              onChange={(nameEvent) => setName(nameEvent.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit();
              }}
            />
            <Button
              className="self-end"
              isDisabled={!name.trim() || fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
              onClick={onSubmit}
            >
              Create
            </Button>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

/**
 * Edits an authored subassembly in place: rename it and change which components it
 * groups (remove a component type, or add the currently-selected components). Membership
 * feeds the motion planner, so the caller nudges the user to re-run planning
 * after saving.
 */
function EditUnitModal({
  instructionId,
  modelUploadId,
  unit,
  graphIndex,
  selectedNodeIds,
  onClose,
  onUpdated
}: {
  instructionId: string;
  modelUploadId: string;
  unit: AssemblyUnit;
  graphIndex: AssemblyGraphIndex | null;
  selectedNodeIds: string[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const [name, setName] = useState(unit.name);
  const [memberIds, setMemberIds] = useState<string[]>(
    unit.componentNodeIds ?? []
  );

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      onUpdated();
    }
  }, [fetcher.state, fetcher.data, onUpdated]);

  const memberSet = useMemo(() => new Set(memberIds), [memberIds]);
  // Distinct components in the unit, so removal is per component type ("drop this cap"),
  // not per individual instance.
  const groups = useMemo(
    () => (graphIndex ? groupComponentNodeIds(memberIds, graphIndex) : []),
    [graphIndex, memberIds]
  );
  // Components currently selected in the tree/viewer that aren't yet members.
  const addableIds = useMemo(
    () => selectedNodeIds.filter((id) => !memberSet.has(id)),
    [selectedNodeIds, memberSet]
  );

  const removeGroup = (group: ComponentGroup) => {
    const drop = new Set(group.nodeIds);
    setMemberIds((prev) => prev.filter((id) => !drop.has(id)));
  };

  const addSelected = () => {
    setMemberIds((prev) => [...prev, ...addableIds]);
  };

  const onSubmit = () => {
    if (!name.trim() || memberIds.length === 0) return;
    const formData = new FormData();
    formData.append("modelUploadId", modelUploadId);
    formData.append("name", name.trim());
    formData.append("componentNodeIds", JSON.stringify(memberIds));
    if (unit.itemId) formData.append("itemId", unit.itemId);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.updateAssemblyUnit(instructionId, unit.id)
    });
  };

  const isSubmitting = fetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Edit subassembly</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={3} className="w-full">
            <Input
              aria-label="Subassembly name"
              placeholder="Subassembly name"
              value={name}
              autoFocus
              onChange={(nameEvent) => setName(nameEvent.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit();
              }}
            />
            <VStack spacing={1} className="w-full">
              <div className="flex w-full items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {memberIds.length} component
                  {memberIds.length === 1 ? "" : "s"} in this subassembly
                </span>
                {addableIds.length > 0 && (
                  <Button variant="secondary" size="sm" onClick={addSelected}>
                    Add {addableIds.length} selected
                  </Button>
                )}
              </div>
              {groups.length > 0 ? (
                <ul className="max-h-64 w-full overflow-y-auto rounded-md border border-border">
                  {groups.map((group) => (
                    <li
                      key={group.key}
                      className="flex items-center gap-2 border-b border-border px-2 py-1 text-sm last:border-b-0"
                    >
                      <ComponentColorSwatch color={group.color} />
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={group.name}
                      >
                        {group.name}
                      </span>
                      <Badge variant="secondary" className="tabular-nums">
                        ×{group.count}
                      </Badge>
                      <IconButton
                        aria-label={`Remove ${group.name} from ${unit.name}`}
                        icon={<LuX />}
                        variant="ghost"
                        size="sm"
                        onClick={() => removeGroup(group)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {graphIndex
                    ? "No components — add a selection or cancel."
                    : "The model is still loading."}
                </p>
              )}
            </VStack>
            <p className="text-xs text-muted-foreground">
              Changing the components redefines the subassembly. Re-run Motion
              Planning to apply the change to the steps.
            </p>
            <Button
              className="self-end"
              isDisabled={
                !name.trim() || memberIds.length === 0 || isSubmitting
              }
              isLoading={isSubmitting}
              onClick={onSubmit}
            >
              Save
            </Button>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function ComponentRow({
  group,
  selection,
  hidden,
  isExpanded,
  usage,
  mapping,
  bomMaterials,
  bomByItemId,
  canMap,
  modelUploadId,
  instructionId,
  style,
  onClick,
  onToggleHide,
  onToggleExpand,
  onSelectStep
}: {
  group: ComponentGroup;
  selection: SelectionState;
  hidden: SelectionState;
  isExpanded: boolean;
  usage: { stepId: string; index: number; title: string }[];
  mapping: AssemblyComponentMapping | null;
  bomMaterials: FlattenedBomMaterial[];
  bomByItemId: Map<string, FlattenedBomMaterial>;
  canMap: boolean;
  modelUploadId: string | null;
  instructionId: string;
  style: React.CSSProperties;
  onClick: (event: MouseEvent) => void;
  onToggleHide: () => void;
  onToggleExpand: () => void;
  onSelectStep: (stepId: string) => void;
}) {
  const bomLine = mapping ? bomByItemId.get(mapping.itemId) : undefined;
  const quantityMismatch =
    bomLine !== undefined && Math.round(bomLine.quantity) !== group.count;
  const allHidden = hidden === "all";
  const expandable = group.count > 1;

  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={cn(
        "group relative flex cursor-pointer select-none items-center gap-2 border-b border-border px-3 text-sm hover:bg-accent/30",
        // Selection gets a blue left bar plus a blue wash. A partly-selected
        // group reads lighter than a full one.
        selection === "all" && "bg-blue-500/10 hover:bg-blue-500/10",
        selection === "partial" && "bg-blue-500/5 hover:bg-blue-500/5",
        allHidden && "opacity-50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event as unknown as MouseEvent);
        }
      }}
    >
      {selection !== "none" && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-blue-500",
            selection === "partial" && "opacity-50"
          )}
        />
      )}
      {expandable ? (
        <button
          type="button"
          aria-label={
            isExpanded ? `Collapse ${group.name}` : `Expand ${group.name}`
          }
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {isExpanded ? (
            <LuChevronDown className="h-3.5 w-3.5" />
          ) : (
            <LuChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden />
      )}
      <ComponentColorSwatch color={group.color} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={group.name}>
          {group.name}
        </span>
        {mapping?.item && (
          <span
            className={cn(
              "truncate text-xs",
              // Mismatch stands out via full-strength text + the explicit "≠"
              // clause below — no colored status text (see .ai/ds-rules.md)
              quantityMismatch ? "text-foreground" : "text-muted-foreground"
            )}
            title={mapping.item.name ?? undefined}
          >
            {mapping.item.readableIdWithRevision}
            {quantityMismatch &&
              bomLine &&
              ` · BOM qty ${Math.round(bomLine.quantity)} ≠ model ${group.count}`}
          </span>
        )}
      </div>
      <Badge variant="secondary" className="tabular-nums">
        ×{group.count}
      </Badge>
      {/* Ghost icon buttons sit flush together (no gap between them) */}
      <div className="flex items-center">
        <IconButton
          aria-label={allHidden ? `Show ${group.name}` : `Hide ${group.name}`}
          icon={allHidden ? <LuEyeOff /> : <LuEye />}
          variant="ghost"
          size="sm"
          className={cn(
            "focus:opacity-100",
            // A group with any hidden instance keeps the eye visible as its
            // status + control; fully-visible groups reveal it on hover.
            hidden !== "none"
              ? "opacity-100 text-muted-foreground"
              : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(event) => {
            event.stopPropagation();
            onToggleHide();
          }}
        />
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              aria-label={`Component details: ${group.name}`}
              icon={<LuSettings />}
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => event.stopPropagation()}
            />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 text-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <ComponentDetails
              group={group}
              usage={usage}
              mapping={mapping}
              bomMaterials={bomMaterials}
              canMap={canMap}
              modelUploadId={modelUploadId}
              instructionId={instructionId}
              onSelectStep={onSelectStep}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/** A single instance of an expanded group — selectable and hideable on its own. */
function InstanceRow({
  group,
  instanceIndex,
  isSelected,
  isHidden,
  style,
  onClick,
  onToggleHide
}: {
  group: ComponentGroup;
  instanceIndex: number;
  isSelected: boolean;
  isHidden: boolean;
  style: React.CSSProperties;
  onClick: (event: MouseEvent) => void;
  onToggleHide: () => void;
}) {
  const label = `${group.name} #${instanceIndex + 1}`;
  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={cn(
        "group relative flex cursor-pointer select-none items-center gap-2 border-b border-border py-1 pl-9 pr-3 text-sm hover:bg-accent/30",
        isSelected && "bg-blue-500/10 hover:bg-blue-500/10",
        isHidden && "opacity-50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event as unknown as MouseEvent);
        }
      }}
    >
      {isSelected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-blue-500"
        />
      )}
      <ComponentColorSwatch color={group.color} />
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={label}
      >
        {group.name}{" "}
        <span className="tabular-nums text-foreground">
          #{instanceIndex + 1}
        </span>
      </span>
      <IconButton
        aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
        icon={isHidden ? <LuEyeOff /> : <LuEye />}
        variant="ghost"
        size="sm"
        className={cn(
          "focus:opacity-100",
          isHidden
            ? "opacity-100 text-muted-foreground"
            : "opacity-0 group-hover:opacity-100"
        )}
        onClick={(event) => {
          event.stopPropagation();
          onToggleHide();
        }}
      />
    </div>
  );
}

function ComponentDetails({
  group,
  usage,
  mapping,
  bomMaterials,
  canMap,
  modelUploadId,
  instructionId,
  onSelectStep
}: {
  group: ComponentGroup;
  usage: { stepId: string; index: number; title: string }[];
  mapping: AssemblyComponentMapping | null;
  bomMaterials: FlattenedBomMaterial[];
  canMap: boolean;
  modelUploadId: string | null;
  instructionId: string;
  onSelectStep: (stepId: string) => void;
}) {
  const mapFetcher = useFetcher<{ success: boolean }>();
  const size = [
    group.bbox.max[0] - group.bbox.min[0],
    group.bbox.max[1] - group.bbox.min[1],
    group.bbox.max[2] - group.bbox.min[2]
  ];

  const onMap = (itemId: string) => {
    if (!modelUploadId) return;
    const formData = new FormData();
    formData.append("modelUploadId", modelUploadId);
    formData.append("geometryHash", group.key);
    formData.append("itemId", itemId);
    mapFetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyComponentMapping(instructionId)
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ComponentColorSwatch color={group.color} />
        <p className="min-w-0 flex-1 truncate font-medium" title={group.name}>
          {group.name}
        </p>
        <Badge variant="secondary" className="tabular-nums">
          ×{group.count}
        </Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Size</dt>
        <dd className="tabular-nums">
          {size.map((dim) => formatLength(dim)).join(" × ")} mm
        </dd>
        <dt className="text-muted-foreground">Volume</dt>
        <dd className="tabular-nums">{formatVolume(group.volume)}</dd>
      </dl>
      {bomMaterials.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Bill of materials</p>
          {mapping?.item ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {mapping.item.readableIdWithRevision} · {mapping.item.name}
              </span>
              {canMap && (
                <IconButton
                  aria-label="Remove BOM mapping"
                  icon={<LuTrash />}
                  variant="ghost"
                  size="sm"
                  isDisabled={mapFetcher.state !== "idle"}
                  onClick={() => {
                    mapFetcher.submit(new FormData(), {
                      method: "post",
                      action: path.to.deleteAssemblyComponentMapping(
                        instructionId,
                        mapping.id
                      )
                    });
                  }}
                />
              )}
            </div>
          ) : canMap ? (
            <ul className="flex max-h-36 flex-col overflow-y-auto">
              {bomMaterials.map((material) => (
                <li key={`${material.itemId}-${material.depth}`}>
                  <button
                    type="button"
                    className="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                    disabled={mapFetcher.state !== "idle"}
                    title={material.name ?? undefined}
                    onClick={() => onMap(material.itemId)}
                  >
                    <span className="text-muted-foreground tabular-nums mr-1">
                      ×{Math.round(material.quantity)}
                    </span>
                    {material.readableIdWithRevision} · {material.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Not mapped</p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Used in steps</p>
        {usage.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Not referenced by any step
          </p>
        ) : (
          <ul className="flex flex-col">
            {usage.map((entry) => (
              <li key={entry.stepId}>
                <button
                  type="button"
                  className="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent"
                  title={entry.title}
                  onClick={() => onSelectStep(entry.stepId)}
                >
                  <span className="text-muted-foreground tabular-nums mr-1">
                    {entry.index + 1}.
                  </span>
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatLength(mm: number): string {
  return mm >= 100 ? mm.toFixed(0) : mm.toFixed(1);
}

function formatVolume(mm3: number | null): string {
  if (mm3 === null) return "—";
  if (mm3 >= 1000) return `${(mm3 / 1000).toFixed(1)} cm³`;
  return `${mm3.toFixed(0)} mm³`;
}
