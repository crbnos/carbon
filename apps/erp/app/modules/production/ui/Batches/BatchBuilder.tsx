import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  Count,
  cn,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Heading,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useLocalStorage,
  VStack
} from "@carbon/react";
import {
  type BatchRuleDimension,
  type BatchRules,
  type BatchType,
  formatDate,
  formatDurationMilliseconds,
  RoundingMode,
  resolveBatchRules,
  round
} from "@carbon/utils";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCalendarClock,
  LuLayers,
  LuLayoutGrid,
  LuList,
  LuListFilter,
  LuLock,
  LuPackageSearch,
  LuPlus,
  LuSearch,
  LuSparkles,
  LuTimer,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { ItemThumbnail, Table } from "~/components";
import { path } from "~/utils/path";
import type { jobStatus } from "../../production.models";
import type { BatchCandidate } from "../../types";
import JobStatus from "../Jobs/JobStatus";
import {
  batchPlanBreakdown,
  candidateValueSets,
  computeGuideMismatches,
  computeLockedById,
  computeSelectionDimSets,
  deriveAddTargets,
  deriveFacetDimensions,
  dueDateOf,
  type FacetDimension,
  filterAndSortCandidates,
  groupingKey,
  groupSetupSaving,
  MATERIAL_FACET_KEY,
  materialSignature,
  rankSuggestions,
  resolveRepCapacity,
  type Suggestion
} from "./batch-builder-logic";

// The candidate list is fetched whole (no server paging) and neither view
// virtualizes, so cap the DOM and say so when truncated.
const MAX_VISIBLE = 250;

// Warn when the chosen operations couple due dates further apart than this: the
// batch runs at its most-urgent member's time, so the rest is pulled early.
const DUE_SPREAD_WARNING_DAYS = 7;

const DUE_WINDOWS = [7, 14, 30] as const;

// Per-candidate compatibility signals against the current selection, threaded to
// the list views. `lockedById` = must-blocked (not co-selectable); `guideMismatchById`
// = advisory guide mismatch; `dimLabel` = translated dimension names for tags.
type CompatInfo = {
  rules: Required<BatchRules>;
  lockedById: Map<string, BatchRuleDimension[]>;
  guideMismatchById: Map<string, BatchRuleDimension[]>;
  dimLabel: Record<BatchRuleDimension, string>;
};

// One quiet tag on a candidate row: a locked "must" mismatch (grey, with lock),
// or an advisory guide mismatch (amber). Locked wins when both are present.
function CompatBadge({
  candidateId,
  compat
}: {
  candidateId: string;
  compat: CompatInfo;
}) {
  const { t } = useLingui();
  const locked = compat.lockedById.get(candidateId);
  const guide = compat.guideMismatchById.get(candidateId);

  if (locked?.length) {
    const names = locked.map((d) => compat.dimLabel[d]).join(", ");
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        title={t`A "must match" rule on this process blocks these from sharing a batch`}
      >
        <LuLock className="size-3" />
        {t`${names} must match — separate load`}
      </span>
    );
  }

  if (guide?.length) {
    const names = guide.map((d) => compat.dimLabel[d]).join(", ");
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400"
        title={t`Differs from the selection — allowed, but confirm they nest together`}
      >
        <LuTriangleAlert className="size-3" />
        {t`${names} differs`}
      </span>
    );
  }

  return null;
}

// Job statuses already on the floor — the norm for a candidate, so no chip.
// Anything else (Draft/Planned) is a job the batch would pull forward; chip it
// with the same status badge the job tables use, so the planner sees that
// choice before creating (or releasing) the batch.
const FLOOR_JOB_STATUSES: readonly string[] = [
  "Ready",
  "In Progress",
  "Paused"
];

function CandidateJobStatus({ status }: { status: string | null }) {
  if (!status || FLOOR_JOB_STATUSES.includes(status)) return null;
  return (
    <JobStatus
      status={status as (typeof jobStatus)[number]}
      className="flex-shrink-0"
    />
  );
}

// The material chips shown on a candidate row: one per distinct BOM line —
// property string when present, else the material item's readable id.
function materialChips(candidate: BatchCandidate): string[] {
  const chips = new Set<string>();
  for (const m of candidate.materials ?? []) {
    const parts = [
      m.substanceName,
      m.gradeName,
      m.dimensionName,
      m.formName,
      m.finishName
    ].filter(Boolean);
    const chip = parts.length ? parts.join(" ") : m.itemReadableId;
    if (chip) chips.add(chip);
  }
  return [...chips];
}

// Numbered wizard step marker (StockTransferWizard precedent).
function StepBadge({ step, active }: { step: number; active: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center size-5 rounded-full text-[11px] font-semibold flex-shrink-0",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      )}
    >
      {step}
    </span>
  );
}

type BatchBuilderBatch = {
  id: string;
  readableId: string;
  processId: string;
  locationId: string;
  members: {
    id: string;
    jobReadableId: string | null;
    itemReadableId: string | null;
    description: string | null;
    operationQuantity: number | null;
  }[];
};

type BuilderView = "table" | "grouped";

type StoredScope = {
  locationId?: string;
  processId?: string;
  view?: BuilderView;
};

type HiddenOps = {
  total: number;
  started: number;
  batched: number;
};

const NO_HIDDEN_OPS: HiddenOps = {
  total: 0,
  started: 0,
  batched: 0
};

type CandidatesResponse = {
  candidates: BatchCandidate[];
  workCenterLoad: Record<string, number>;
  hidden: HiddenOps;
};

export function BatchBuilder({
  onClose,
  defaultLocationId,
  initialLocationId,
  initialProcessId,
  locations,
  processes,
  workCenters,
  batch
}: {
  onClose: () => void;
  defaultLocationId: string;
  initialLocationId?: string | null;
  initialProcessId?: string | null;
  locations: { id: string; name: string }[];
  processes: {
    id: string;
    name: string;
    batchType?: BatchType | null;
    batchRules?: BatchRules | null;
  }[];
  workCenters: {
    id: string;
    name: string;
    locationId: string | null;
    processes: string[];
    batchCapacity: number | null;
    minimumBatchQuantity: number | null;
  }[];
  batch?: BatchBuilderBatch | null;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();

  const isAddMode = !!batch;

  const [stored, setStored] = useLocalStorage<StoredScope>(
    "batch-builder-scope",
    {}
  );

  const [locationId, setLocationId] = useState(
    batch?.locationId ?? initialLocationId ?? defaultLocationId
  );
  const [processId, setProcessId] = useState<string | null>(
    batch?.processId ?? initialProcessId ?? null
  );
  const [search, setSearch] = useState("");
  const [facets, setFacets] = useState<Record<string, string[]>>({});
  const [dueWindow, setDueWindow] = useState<number | null>(null);
  const [workCenterId, setWorkCenterId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const view: BuilderView = stored.view ?? "table";

  // Selection is held here (not via the Table's index-keyed rowSelection, which
  // resets when the filtered data length changes) so the full candidate object
  // survives even while filtered out of view.
  const [selectedById, setSelectedById] = useState<Map<string, BatchCandidate>>(
    new Map()
  );

  // useLocalStorage hydrates AFTER mount, so the remembered scope is applied in
  // a one-shot effect — and only when neither add-mode nor a deep link already
  // decided the scope, and the user hasn't touched the pickers yet.
  const scopeTouched = useRef(false);
  const storedApplied = useRef(false);
  useEffect(() => {
    if (storedApplied.current || scopeTouched.current) return;
    if (isAddMode || initialLocationId || initialProcessId) {
      storedApplied.current = true;
      return;
    }
    const validLocation =
      stored.locationId && locations.some((l) => l.id === stored.locationId)
        ? stored.locationId
        : null;
    const validProcess =
      stored.processId && processes.some((p) => p.id === stored.processId)
        ? stored.processId
        : null;
    if (!validLocation && !validProcess) return;
    storedApplied.current = true;
    if (validLocation) setLocationId(validLocation);
    if (validProcess) setProcessId(validProcess);
  }, [
    stored,
    isAddMode,
    initialLocationId,
    initialProcessId,
    locations,
    processes
  ]);

  const candidatesFetcher = useFetcher<CandidatesResponse>();
  const submitFetcher = useFetcher<{
    success?: boolean;
    message?: string;
    batchId?: string | null;
  }>();

  // Load candidates whenever the scope is complete. Only the scope drives the
  // fetch — the fetcher's `.load` identity is unstable and must not be a dep.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — scope-only trigger
  useEffect(() => {
    if (!locationId || !processId) return;
    candidatesFetcher.load(
      path.to.api.batchableOperations(locationId, processId)
    );
  }, [locationId, processId]);

  // A scope change invalidates the current selection and filters.
  const resetComposition = useCallback(() => {
    setSelectedById(new Map());
    setSearch("");
    setFacets({});
    setDueWindow(null);
    setWorkCenterId(null);
  }, []);

  const onScopeChange = useCallback(
    (next: { locationId?: string; processId?: string }) => {
      scopeTouched.current = true;
      if (next.locationId) setLocationId(next.locationId);
      if (next.processId !== undefined) setProcessId(next.processId);
      resetComposition();
      if (!isAddMode) {
        setStored((prev) => ({ ...prev, ...next }));
      }
    },
    [isAddMode, resetComposition, setStored]
  );

  const setView = useCallback(
    (next: BuilderView) => setStored((prev) => ({ ...prev, view: next })),
    [setStored]
  );

  const workCenterNameById = useMemo(
    () => new Map(workCenters.map((wc) => [wc.id, wc.name] as const)),
    [workCenters]
  );

  const allCandidates = useMemo(
    () => candidatesFetcher.data?.candidates ?? [],
    [candidatesFetcher.data]
  );
  const workCenterLoad = useMemo(
    () => candidatesFetcher.data?.workCenterLoad ?? {},
    [candidatesFetcher.data]
  );
  const hidden = useMemo(
    () => candidatesFetcher.data?.hidden ?? NO_HIDDEN_OPS,
    [candidatesFetcher.data]
  );

  // "6 hidden" alone reads as a bug when the list is empty — name the reasons.
  const hiddenParts = [
    hidden.started > 0 ? t`${hidden.started} already started` : null,
    hidden.batched > 0 ? t`${hidden.batched} already in a batch` : null
  ].filter((p): p is string => Boolean(p));
  const hiddenSummary =
    hidden.total > 0 && hiddenParts.length > 0
      ? t`${hidden.total} operations on this process are not listed: ${hiddenParts.join(", ")}`
      : null;

  // Only unbatched operations are addable; rows in a batch feed the add-to
  // targets (Active) and add-mode's member list instead.
  const candidates = useMemo(
    () => allCandidates.filter((c) => !c.jobOperationBatchId),
    [allCandidates]
  );

  // Existing Active batches on this process — offered as add targets so a
  // planner extends a batch instead of accidentally creating a duplicate.
  const addTargets = useMemo(
    () => deriveAddTargets(allCandidates),
    [allCandidates]
  );

  // Compatibility rules for the scoped process. Defaults (substance/grade/
  // dimension guide, the rest ignore) reproduce the pre-rules behavior, so an
  // unconfigured process groups and warns exactly as before.
  const rules = useMemo(
    () =>
      resolveBatchRules(
        processes.find((p) => p.id === processId)?.batchRules ?? null
      ),
    [processes, processId]
  );

  // The scoped process's duration model for the review preview: Sequential
  // members run one after another off the shared setup (labor/machine sum);
  // Simultaneous members share one cycle, e.g. a furnace load (max).
  const batchType: BatchType =
    processes.find((p) => p.id === processId)?.batchType ?? "Sequential";

  const dimLabel = useMemo<Record<BatchRuleDimension, string>>(
    () => ({
      item: t`material item`,
      substance: t`substance`,
      grade: t`grade`,
      dimension: t`dimension`,
      form: t`form`,
      finish: t`finish`
    }),
    [t]
  );

  // The selection's per-dimension value sets, and their folded intersection per
  // dimension (only members that carry a value for it). Drives must-locks and
  // guide-mismatch tags against the current selection.
  const selectedValueSets = useMemo(
    () => [...selectedById.values()].map(candidateValueSets),
    [selectedById]
  );
  const selectedIds = useMemo(
    () => new Set(selectedById.keys()),
    [selectedById]
  );
  const selectionDimSets = useMemo(
    () => computeSelectionDimSets(selectedValueSets),
    [selectedValueSets]
  );

  // A candidate is LOCKED when adding it to the current selection would leave a
  // "must" dimension with no shared value. Empty selection locks nothing.
  const lockedById = useMemo(
    () => computeLockedById(candidates, selectedIds, selectedValueSets, rules),
    [candidates, selectedIds, selectedValueSets, rules]
  );

  // GUIDE mismatches (advisory): a guide dimension where the selection has a
  // value the candidate can't match. Warned, never blocked.
  const guideMismatchById = useMemo(
    () =>
      computeGuideMismatches(
        candidates,
        selectedIds,
        selectedValueSets,
        selectionDimSets,
        rules
      ),
    [candidates, selectedIds, selectedValueSets, selectionDimSets, rules]
  );

  const compat = useMemo<CompatInfo>(
    () => ({ rules, lockedById, guideMismatchById, dimLabel }),
    [rules, lockedById, guideMismatchById, dimLabel]
  );

  // Filterable dimensions derived from what the candidates' BOMs actually
  // contain: the material items themselves plus whichever normalized
  // properties are populated. A dimension with no values doesn't appear.
  const facetDimensions = useMemo<FacetDimension[]>(() => {
    const labels: Record<string, string> = {
      [MATERIAL_FACET_KEY]: t`Material`,
      substanceId: t`Substance`,
      gradeId: t`Grade`,
      dimensionId: t`Dimension`,
      formId: t`Form`,
      finishId: t`Finish`
    };
    return deriveFacetDimensions(candidates, labels);
  }, [candidates, t]);

  const activeFacetKeys = useMemo(
    () => Object.keys(facets).filter((k) => (facets[k]?.length ?? 0) > 0),
    [facets]
  );

  // A candidate matches if ANY BOM line satisfies ALL active facets, the search
  // term matches its job/item/op text, and it falls inside the due window.
  // Sorted most-urgent first (due date asc, undated last).
  const filtered = useMemo(
    () =>
      filterAndSortCandidates(candidates, {
        activeFacetKeys,
        facets,
        search,
        dueWindow,
        today: today(getLocalTimeZone())
      }),
    [candidates, activeFacetKeys, facets, search, dueWindow]
  );

  const visible = useMemo(() => filtered.slice(0, MAX_VISIBLE), [filtered]);

  // A representative run size for suggestion scoring. Once a work center is
  // chosen its own batchCapacity is authoritative — the "fills a run" chip and
  // the fill bar must agree. Before one is chosen, fall back to the largest
  // batchCapacity among the centers that can run this process here.
  const repCapacity = useMemo(
    () => resolveRepCapacity(workCenters, workCenterId, locationId, processId),
    [workCenters, workCenterId, locationId, processId]
  );

  // Suggested batches: groups of ≥2 unselected, co-selectable candidates sharing
  // a material signature, SCORED by setup saved + due urgency + capacity fit +
  // match tightness (see rankSuggestions). One click merges a group into the
  // selection. (Table view only — the grouped view's sections carry the same
  // information.)
  const suggestions = useMemo(() => {
    const now = today(getLocalTimeZone());
    const daysUntil = (due: string) => parseDate(due).compare(now);
    const groups = new Map<string, BatchCandidate[]>();
    for (const c of candidates) {
      if (selectedById.has(c.id)) continue;
      if (lockedById.has(c.id)) continue; // not co-selectable with the selection
      const sig = groupingKey(c, rules);
      if (!sig) continue;
      const g = groups.get(sig) ?? [];
      g.push(c);
      groups.set(sig, g);
    }
    return rankSuggestions(groups, rules, repCapacity, daysUntil);
  }, [candidates, selectedById, lockedById, rules, repCapacity]);

  const toggle = useCallback(
    (candidate: BatchCandidate) => {
      // A must-locked candidate can't join the current selection — no-op unless
      // it's already selected (then it's a deselect).
      if (lockedById.has(candidate.id) && !selectedById.has(candidate.id)) {
        return;
      }
      setSelectedById((prev) => {
        const next = new Map(prev);
        if (next.has(candidate.id)) next.delete(candidate.id);
        else next.set(candidate.id, candidate);
        return next;
      });
    },
    [lockedById, selectedById]
  );

  const selectMany = useCallback(
    (toAdd: BatchCandidate[]) => {
      setSelectedById((prev) => {
        const next = new Map(prev);
        for (const c of toAdd) {
          if (lockedById.has(c.id) && !next.has(c.id)) continue;
          next.set(c.id, c);
        }
        return next;
      });
    },
    [lockedById]
  );

  const deselectMany = useCallback((toRemove: BatchCandidate[]) => {
    setSelectedById((prev) => {
      const next = new Map(prev);
      for (const c of toRemove) next.delete(c.id);
      return next;
    });
  }, []);

  // "Select all" ignores must-locked rows (they can't join the selection), so
  // all-selected means every SELECTABLE visible row is selected.
  const allVisibleSelected =
    visible.length > 0 &&
    visible
      .filter((c) => !lockedById.has(c.id))
      .every((c) => selectedById.has(c.id));
  const toggleAllVisible = useCallback(() => {
    setSelectedById((prev) => {
      const next = new Map(prev);
      const selectable = visible.filter((c) => !lockedById.has(c.id));
      const shouldSelect = !selectable.every((c) => next.has(c.id));
      for (const c of selectable) {
        if (shouldSelect) next.set(c.id, c);
        else next.delete(c.id);
      }
      return next;
    });
  }, [visible, lockedById]);

  const selected = useMemo(() => [...selectedById.values()], [selectedById]);

  // Toast on submit failure; navigate on success. addTargetRef remembers which
  // existing batch an add-to submit targeted (the action returns no id for add).
  const addTargetRef = useRef<string | null>(null);
  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (submitFetcher.state !== "idle") {
      wasSubmitting.current = true;
      return;
    }
    if (!wasSubmitting.current) return;
    wasSubmitting.current = false;
    const data = submitFetcher.data;
    if (!data) return;
    if (data.success === false && data.message) {
      toast.error(data.message);
      return;
    }
    if (data.success) {
      const targetId = isAddMode
        ? batch?.id
        : (addTargetRef.current ?? data.batchId);
      if (targetId) navigate(path.to.operationBatch(targetId));
      else navigate(path.to.operationBatches);
    }
  }, [submitFetcher.state, submitFetcher.data, isAddMode, batch?.id, navigate]);

  const submit = (targetBatchId?: string, opts?: { release?: boolean }) => {
    const fd = new FormData();
    if (isAddMode || targetBatchId) {
      addTargetRef.current = targetBatchId ?? null;
      fd.set("intent", "add");
      fd.set("batchId", isAddMode ? batch.id : (targetBatchId as string));
    } else {
      addTargetRef.current = null;
      fd.set("intent", "create");
      fd.set("locationId", locationId);
      if (workCenterId) fd.set("workCenterId", workCenterId);
      if (notes.trim()) fd.set("notes", notes.trim());
      // Create & Release: the create validator's zfd.checkbox reads "on" and
      // the edge fn inserts the batch already Active (on the floor).
      if (opts?.release) fd.set("release", "on");
    }
    for (const id of selectedById.keys()) fd.append("jobOperationIds", id);
    submitFetcher.submit(fd, {
      method: "post",
      action: path.to.priorityBatchingUpdate
    });
  };

  const isSubmitting = submitFetcher.state !== "idle";
  const isLoading = candidatesFetcher.state !== "idle";

  const locationOptions = useMemo(
    () => locations.map((l) => ({ value: l.id, label: l.name })),
    [locations]
  );
  const processOptions = useMemo(
    () => processes.map((p) => ({ value: p.id, label: p.name })),
    [processes]
  );
  // Only centers that can RUN the scoped process, at the batch's location —
  // offering the paint booth for a welding batch is master-data nonsense. When
  // a company never linked its work centers to processes, fall back to the
  // location's centers rather than an empty picker.
  const workCenterOptions = useMemo(() => {
    const atLocation = workCenters.filter(
      (wc) => !wc.locationId || wc.locationId === locationId
    );
    const forProcess = processId
      ? atLocation.filter((wc) => wc.processes.includes(processId))
      : atLocation;
    const eligible = forProcess.length > 0 ? forProcess : atLocation;
    return eligible.map((wc) => {
      const load = workCenterLoad[wc.id] ?? 0;
      // `helper` renders under the label; Combobox only shows `helperRight`
      // when `helper` is also present, so the queue depth goes in `helper`.
      return {
        value: wc.id,
        label: wc.name,
        ...(load > 0 ? { helper: t`${load} in queue` } : {})
      };
    });
  }, [workCenters, workCenterLoad, locationId, processId, t]);

  const selectedWorkCenter = useMemo(
    () => workCenters.find((wc) => wc.id === workCenterId) ?? null,
    [workCenters, workCenterId]
  );

  // Release needs a work center the batch can run at: the explicit pick, or —
  // mirroring the edge fn's adoption rule — the single distinct work center
  // the selected members already sit on (members without one don't block
  // adoption). Otherwise the edge fn refuses Create & Release.
  const memberWorkCenterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of selected) {
      if (c.workCenterId) ids.add(c.workCenterId);
    }
    return ids;
  }, [selected]);
  const canRelease = Boolean(workCenterId) || memberWorkCenterIds.size === 1;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="full">
        <DrawerHeader className="px-4 flex-shrink-0">
          <DrawerTitle>
            {isAddMode ? (
              <Trans>Add operations to {batch.readableId}</Trans>
            ) : (
              <Trans>New Batch</Trans>
            )}
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            <Trans>
              Pick a batchable process, filter the eligible operations by their
              material, and select the ones to run together.
            </Trans>
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBodyGrid
          scope={
            <ScopeBar
              isAddMode={isAddMode}
              batchReadableId={batch?.readableId}
              processName={
                processes.find((p) => p.id === processId)?.name ?? null
              }
              locationName={
                locations.find((l) => l.id === locationId)?.name ?? null
              }
              locationOptions={locationOptions}
              processOptions={processOptions}
              locationId={locationId}
              processId={processId}
              onLocationChange={(id) => onScopeChange({ locationId: id })}
              onProcessChange={(id) => onScopeChange({ processId: id })}
            />
          }
          left={
            !processId ? (
              <VStack
                spacing={0}
                className="h-full min-h-0 overflow-hidden bg-card"
              >
                <PanelHeading step={2} active={false}>
                  <Trans>Select operations</Trans>
                </PanelHeading>
                <EmptyState
                  icon={<LuLayers className="h-6 w-6" />}
                  title={t`Pick a process to start`}
                  hint={t`Choose a batchable process to see the operations that can run together.`}
                />
              </VStack>
            ) : (
              <ComposePanel
                view={view}
                onViewChange={setView}
                isLoading={isLoading}
                search={search}
                onSearchChange={setSearch}
                facets={facets}
                dimensions={facetDimensions}
                onFacetChange={(key, values) =>
                  setFacets((prev) => ({ ...prev, [key]: values }))
                }
                dueWindow={dueWindow}
                onDueWindowChange={setDueWindow}
                suggestions={suggestions}
                onApplySuggestion={selectMany}
                visible={visible}
                totalFiltered={filtered.length}
                hiddenSummary={hiddenSummary}
                selectedById={selectedById}
                onToggle={toggle}
                onSelectMany={selectMany}
                onDeselectMany={deselectMany}
                allVisibleSelected={allVisibleSelected}
                onToggleAllVisible={toggleAllVisible}
                workCenterNameById={workCenterNameById}
                compat={compat}
              />
            )
          }
          right={
            <ReviewPanel
              isAddMode={isAddMode}
              existingMembers={batch?.members ?? []}
              selected={selected}
              rules={rules}
              batchType={batchType}
              onRemove={toggle}
              workCenterId={workCenterId}
              workCenterOptions={workCenterOptions}
              onWorkCenterChange={setWorkCenterId}
              batchCapacity={selectedWorkCenter?.batchCapacity ?? null}
              minimumBatchQuantity={
                selectedWorkCenter?.minimumBatchQuantity ?? null
              }
              notes={notes}
              onNotesChange={setNotes}
            />
          }
        />

        <DrawerFooter className="flex-shrink-0 border-t bg-card sm:justify-end items-center">
          <HStack spacing={2}>
            <Button
              variant="ghost"
              isDisabled={selected.length === 0 || isSubmitting}
              onClick={() => setSelectedById(new Map())}
            >
              {t`Clear`}
            </Button>
            {!isAddMode &&
              selected.length > 0 &&
              addTargets.slice(0, 2).map((target) => (
                <Button
                  key={target.batchId}
                  variant="secondary"
                  leftIcon={<LuPlus />}
                  isDisabled={isSubmitting}
                  onClick={() => submit(target.batchId)}
                >
                  {t`Add to ${target.readableId}`}
                </Button>
              ))}
            {!isAddMode &&
              (canRelease ? (
                <Button
                  variant="secondary"
                  isDisabled={selected.length === 0 || isSubmitting}
                  onClick={() => submit(undefined, { release: true })}
                >
                  {t`Create & Release`}
                </Button>
              ) : (
                <Tooltip>
                  {/* A disabled button swallows pointer and focus events, so
                      the wrapper carries the tooltip (ItemChangeNoticeLock
                      precedent). */}
                  <TooltipTrigger asChild>
                    <div tabIndex={0}>
                      <Button variant="secondary" isDisabled>
                        {t`Create & Release`}
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t`Select a work center to release`}
                  </TooltipContent>
                </Tooltip>
              ))}
            <Button
              leftIcon={<LuLayers />}
              isLoading={isSubmitting}
              isDisabled={selected.length === 0 || isSubmitting}
              onClick={() => submit()}
            >
              {isAddMode
                ? t`Add ${selected.length} operations`
                : t`Create batch`}
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function DrawerBodyGrid({
  scope,
  left,
  right
}: {
  scope: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="flex-shrink-0 border-b px-4 py-3 bg-card">{scope}</div>
      <ResizablePanelGroup
        direction="horizontal"
        className="h-full w-full min-h-0"
      >
        <ResizablePanel
          defaultSize={62}
          minSize={40}
          className="flex flex-col min-h-0 overflow-hidden"
        >
          {left}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          defaultSize={38}
          minSize={25}
          className="flex flex-col min-h-0 overflow-hidden"
        >
          {right}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function PanelHeading({
  step,
  active,
  children,
  right
}: {
  step: number;
  active: boolean;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <HStack
      spacing={2}
      className="px-4 py-3 border-b w-full flex-shrink-0 items-center justify-between"
    >
      <HStack spacing={2} className="items-center">
        <StepBadge step={step} active={active} />
        <Heading size="h4">{children}</Heading>
      </HStack>
      {right}
    </HStack>
  );
}

function ScopeBar({
  isAddMode,
  batchReadableId,
  processName,
  locationName,
  locationOptions,
  processOptions,
  locationId,
  processId,
  onLocationChange,
  onProcessChange
}: {
  isAddMode: boolean;
  batchReadableId?: string;
  processName: string | null;
  locationName: string | null;
  locationOptions: { value: string; label: string }[];
  processOptions: { value: string; label: string }[];
  locationId: string;
  processId: string | null;
  onLocationChange: (id: string) => void;
  onProcessChange: (id: string) => void;
}) {
  const { t } = useLingui();
  if (isAddMode) {
    return (
      <HStack spacing={2} className="items-center">
        <StepBadge step={1} active />
        <Badge variant="secondary">
          <LuLayers className="size-3 mr-1" />
          {batchReadableId}
        </Badge>
        {processName && <span className="text-sm">{processName}</span>}
        {locationName && (
          <span className="text-sm text-muted-foreground">{locationName}</span>
        )}
      </HStack>
    );
  }
  return (
    <HStack spacing={2} className="items-center flex-wrap">
      <HStack spacing={2} className="items-center">
        <StepBadge step={1} active />
        <span className="text-sm font-medium">
          <Trans>Scope</Trans>
        </span>
      </HStack>
      <div className="w-[220px]">
        <Combobox
          size="sm"
          value={locationId}
          options={locationOptions}
          onChange={onLocationChange}
          placeholder={t`Location`}
        />
      </div>
      <div className="w-[220px]">
        <Combobox
          size="sm"
          value={processId ?? ""}
          options={processOptions}
          onChange={onProcessChange}
          placeholder={t`Batchable process`}
        />
      </div>
    </HStack>
  );
}

// Checkbox list of one dimension's values — shared by the "+ Filter" picker's
// second level and each active chip's edit popover.
function FacetValueList({
  dimension,
  selected,
  onChange
}: {
  dimension: FacetDimension;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useLingui();
  return (
    <Command>
      <CommandInput placeholder={dimension.label} />
      <CommandEmpty>{t`No results`}</CommandEmpty>
      <CommandGroup className="max-h-[240px] overflow-auto">
        {dimension.options.map((option) => {
          const isChecked = selected.includes(option.value);
          return (
            <CommandItem
              key={option.value}
              value={option.label}
              onSelect={() =>
                onChange(
                  isChecked
                    ? selected.filter((v) => v !== option.value)
                    : [...selected, option.value]
                )
              }
            >
              <HStack spacing={2} className="items-center">
                <Checkbox
                  checked={isChecked}
                  className="pointer-events-none"
                  tabIndex={-1}
                />
                <span className="truncate">{option.label}</span>
              </HStack>
            </CommandItem>
          );
        })}
      </CommandGroup>
    </Command>
  );
}

// "+ Filter": pick a BOM dimension, then check values. Local-state twin of the
// shared table filter (which is URL-param-driven and can't be reused here).
function FacetPicker({
  dimensions,
  facets,
  onFacetChange
}: {
  dimensions: FacetDimension[];
  facets: Record<string, string[]>;
  onFacetChange: (key: string, values: string[]) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = dimensions.find((d) => d.key === activeKey) ?? null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setActiveKey(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" leftIcon={<LuListFilter />}>
          {t`Filter`}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[240px] p-0"
        // Portaled outside the drawer — stop the scroll-lock's document
        // listener from swallowing wheel events (see conventions-ui.md).
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {active ? (
          <FacetValueList
            dimension={active}
            selected={facets[active.key] ?? []}
            onChange={(values) => onFacetChange(active.key, values)}
          />
        ) : (
          <Command>
            <CommandInput placeholder={t`Filter by…`} />
            <CommandEmpty>{t`No results`}</CommandEmpty>
            <CommandGroup>
              {dimensions.map((d) => (
                <CommandItem
                  key={d.key}
                  value={d.label}
                  onSelect={() => setActiveKey(d.key)}
                >
                  {d.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

// An active facet as a removable, click-to-edit pill.
function FacetChip({
  dimension,
  selected,
  onChange
}: {
  dimension: FacetDimension;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useLingui();
  const labels = selected
    .map((v) => dimension.options.find((o) => o.value === v)?.label ?? v)
    .join(", ");

  return (
    <HStack
      spacing={0}
      className="items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs"
    >
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex items-center gap-1 min-w-0">
            <span className="text-muted-foreground flex-shrink-0">
              {dimension.label}
            </span>
            <span className="max-w-[180px] truncate font-medium" title={labels}>
              {labels}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[240px] p-0"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <FacetValueList
            dimension={dimension}
            selected={selected}
            onChange={onChange}
          />
        </PopoverContent>
      </Popover>
      <IconButton
        aria-label={t`Clear filter`}
        variant="ghost"
        size="sm"
        className="size-5 min-w-0 rounded-full"
        icon={<LuX className="size-3" />}
        onClick={() => onChange([])}
      />
    </HStack>
  );
}

// Prominent, scored entry point at the top of the operations list: "N suggested
// batches", each a one-click apply with the reason it's worth doing (soonest due,
// fills a run, setup saved). Ranked by rankSuggestions; must-incompatible groups
// never appear.
function SuggestionsBanner({
  suggestions,
  onApply
}: {
  suggestions: Suggestion[];
  onApply: (members: BatchCandidate[]) => void;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const now = today(getLocalTimeZone());
  const topSaving = Math.max(0, ...suggestions.map((s) => s.saving));

  const reasonChip = (s: Suggestion) => {
    if (s.reason === "urgent" && s.earliestDue) {
      const days = parseDate(s.earliestDue).compare(now);
      const label =
        days <= 0
          ? t`due now`
          : days === 1
            ? t`due in 1 day`
            : t`due in ${days} days`;
      return (
        <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
          <LuCalendarClock className="size-3" />
          {label}
        </span>
      );
    }
    if (s.reason === "fills" && s.fillRatio != null) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-600 dark:text-sky-400">
          <LuLayers className="size-3" />
          {t`fills a run`}
        </span>
      );
    }
    return null;
  };

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border bg-gradient-to-b from-emerald-500/[0.07] to-transparent shadow-sm">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="flex size-6 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <LuSparkles className="size-3.5" />
        </span>
        <span className="text-sm font-medium">
          {suggestions.length === 1
            ? t`1 suggested batch`
            : t`${suggestions.length} suggested batches`}
        </span>
        {topSaving > 0 && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {t`up to ${formatDurationMilliseconds(topSaving, {
              style: "short"
            })} saved`}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        {suggestions.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onApply(s.members)}
            className="group flex w-full items-center gap-3 border-t border-border/60 px-3.5 py-2.5 text-left transition-colors hover:bg-emerald-500/[0.06] active:bg-emerald-500/10"
          >
            <span className="flex size-7 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-[13px] font-semibold tabular-nums text-emerald-700 transition-transform group-active:scale-95 dark:text-emerald-300">
              {s.members.length}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium" title={s.sig}>
                  {s.sig}
                </span>
                {reasonChip(s)}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t`${s.members.length} ops · ${s.totalQuantity} pcs`}
                {s.earliestDue
                  ? ` · ${t`due ${formatDate(s.earliestDue, undefined, locale)}`}`
                  : ""}
              </span>
            </div>
            {s.saving > 0 && (
              <span className="hidden flex-shrink-0 items-center gap-1 text-xs tabular-nums text-emerald-600 sm:flex dark:text-emerald-400">
                <LuTimer className="size-3" />
                {formatDurationMilliseconds(s.saving, { style: "short" })}
              </span>
            )}
            <span className="flex flex-shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:border-emerald-500/40 group-hover:bg-emerald-500/10 group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
              <LuPlus className="size-3" />
              {t`Add`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ComposePanel({
  view,
  onViewChange,
  isLoading,
  search,
  onSearchChange,
  facets,
  dimensions,
  onFacetChange,
  dueWindow,
  onDueWindowChange,
  suggestions,
  onApplySuggestion,
  visible,
  totalFiltered,
  hiddenSummary,
  selectedById,
  onToggle,
  onSelectMany,
  onDeselectMany,
  allVisibleSelected,
  onToggleAllVisible,
  workCenterNameById,
  compat
}: {
  view: BuilderView;
  onViewChange: (view: BuilderView) => void;
  isLoading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  facets: Record<string, string[]>;
  dimensions: FacetDimension[];
  onFacetChange: (key: string, values: string[]) => void;
  dueWindow: number | null;
  onDueWindowChange: (days: number | null) => void;
  suggestions: Suggestion[];
  onApplySuggestion: (members: BatchCandidate[]) => void;
  visible: BatchCandidate[];
  totalFiltered: number;
  hiddenSummary: string | null;
  selectedById: Map<string, BatchCandidate>;
  onToggle: (c: BatchCandidate) => void;
  onSelectMany: (cs: BatchCandidate[]) => void;
  onDeselectMany: (cs: BatchCandidate[]) => void;
  allVisibleSelected: boolean;
  onToggleAllVisible: () => void;
  workCenterNameById: Map<string, string>;
  compat: CompatInfo;
}) {
  const { t } = useLingui();

  const activeDimensions = dimensions.filter(
    (d) => (facets[d.key]?.length ?? 0) > 0
  );
  const isFiltered =
    search.trim().length > 0 ||
    dueWindow !== null ||
    activeDimensions.length > 0;

  return (
    <VStack spacing={0} className="h-full min-h-0 overflow-hidden bg-card">
      <PanelHeading
        step={2}
        active
        right={
          <HStack spacing={1}>
            <Button
              size="sm"
              variant={view === "table" ? "secondary" : "ghost"}
              onClick={() => onViewChange("table")}
              aria-label={t`List view`}
            >
              <LuList className="size-4" />
            </Button>
            <Button
              size="sm"
              variant={view === "grouped" ? "secondary" : "ghost"}
              onClick={() => onViewChange("grouped")}
              aria-label={t`Group by material`}
            >
              <LuLayoutGrid className="size-4" />
            </Button>
          </HStack>
        }
      >
        <Trans>Select operations</Trans>
      </PanelHeading>

      <VStack
        spacing={2}
        className="px-4 py-3 border-b w-full flex-shrink-0 items-stretch"
      >
        <HStack spacing={2} className="flex-wrap items-center gap-y-2">
          <InputGroup size="sm" className="w-[220px]">
            <InputLeftElement>
              <LuSearch className="text-muted-foreground w-3.5 h-3.5 mt-[-2px]" />
            </InputLeftElement>
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t`Search jobs or items`}
              className="text-sm"
            />
          </InputGroup>
          <HStack
            spacing={0}
            className="items-center gap-0.5 rounded-md border p-0.5"
            title={t`Due within`}
          >
            <LuCalendarClock className="size-3.5 text-muted-foreground mx-1.5 flex-shrink-0" />
            <Button
              size="sm"
              variant={dueWindow === null ? "secondary" : "ghost"}
              className="h-7 px-2"
              onClick={() => onDueWindowChange(null)}
            >
              {t`All`}
            </Button>
            {DUE_WINDOWS.map((days) => (
              <Button
                key={days}
                size="sm"
                variant={dueWindow === days ? "secondary" : "ghost"}
                className="h-7 px-2 tabular-nums"
                onClick={() => onDueWindowChange(days)}
              >
                {t`${days}d`}
              </Button>
            ))}
          </HStack>
          {activeDimensions.map((d) => (
            <FacetChip
              key={d.key}
              dimension={d}
              selected={facets[d.key] ?? []}
              onChange={(values) => onFacetChange(d.key, values)}
            />
          ))}
          {dimensions.length > 0 && (
            <FacetPicker
              dimensions={dimensions}
              facets={facets}
              onFacetChange={onFacetChange}
            />
          )}
        </HStack>
        {view === "table" && suggestions.length > 0 && (
          <SuggestionsBanner
            suggestions={suggestions}
            onApply={onApplySuggestion}
          />
        )}
      </VStack>

      {view === "table" ? (
        <CandidateTable
          isLoading={isLoading}
          isFiltered={isFiltered}
          visible={visible}
          hiddenSummary={hiddenSummary}
          selectedById={selectedById}
          onToggle={onToggle}
          allVisibleSelected={allVisibleSelected}
          onToggleAllVisible={onToggleAllVisible}
          workCenterNameById={workCenterNameById}
          compat={compat}
        />
      ) : (
        <GroupedCandidateList
          isLoading={isLoading}
          isFiltered={isFiltered}
          visible={visible}
          hiddenSummary={hiddenSummary}
          selectedById={selectedById}
          onToggle={onToggle}
          onSelectMany={onSelectMany}
          onDeselectMany={onDeselectMany}
          workCenterNameById={workCenterNameById}
          compat={compat}
        />
      )}

      {(totalFiltered > visible.length ||
        (hiddenSummary && visible.length > 0)) && (
        <div className="px-4 pb-3 w-full flex-shrink-0">
          {totalFiltered > visible.length && (
            <p className="text-xs text-muted-foreground">
              <Trans>
                Showing {visible.length} of {totalFiltered} — refine your search
              </Trans>
            </p>
          )}
          {hiddenSummary && visible.length > 0 && (
            <p className="text-xs text-muted-foreground">{hiddenSummary}</p>
          )}
        </div>
      )}
    </VStack>
  );
}

function CandidateTable({
  isLoading,
  isFiltered,
  visible,
  hiddenSummary,
  selectedById,
  onToggle,
  allVisibleSelected,
  onToggleAllVisible,
  workCenterNameById,
  compat
}: {
  isLoading: boolean;
  isFiltered: boolean;
  visible: BatchCandidate[];
  hiddenSummary: string | null;
  selectedById: Map<string, BatchCandidate>;
  onToggle: (c: BatchCandidate) => void;
  allVisibleSelected: boolean;
  onToggleAllVisible: () => void;
  workCenterNameById: Map<string, string>;
  compat: CompatInfo;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();

  const columns = useMemo<ColumnDef<BatchCandidate>[]>(
    () => [
      {
        id: "select",
        // Header and cell share the same wrapper geometry (p-3 -m-3 nets to
        // zero) so the checkboxes sit in exactly the same column; the cell's
        // padding is a real hit area, the header's is symmetry.
        header: () => (
          <div className="flex items-center p-3 -m-3">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={onToggleAllVisible}
              aria-label={t`Select all`}
            />
          </div>
        ),
        cell: ({ row }) => {
          const locked =
            compat.lockedById.has(row.original.id) &&
            !selectedById.has(row.original.id);
          return (
            <button
              type="button"
              className={cn(
                "flex items-center p-3 -m-3",
                locked ? "cursor-not-allowed" : "cursor-pointer"
              )}
              onClick={() => !locked && onToggle(row.original)}
              disabled={locked}
              aria-label={t`Select operation`}
            >
              <Checkbox
                checked={selectedById.has(row.original.id)}
                disabled={locked}
                className="pointer-events-none"
                tabIndex={-1}
              />
            </button>
          );
        }
      },
      {
        accessorKey: "jobReadableId",
        header: t`Job`,
        cell: ({ row }) => (
          <HStack spacing={2} className="items-center">
            <span className="font-medium">{row.original.jobReadableId}</span>
            <CandidateJobStatus status={row.original.jobStatus} />
          </HStack>
        )
      },
      {
        accessorKey: "itemReadableId",
        header: t`Item`,
        cell: ({ row }) => (
          <HStack spacing={2}>
            <ItemThumbnail
              thumbnailPath={row.original.thumbnailPath}
              type="Part"
              size="sm"
            />
            <VStack spacing={0} className="min-w-0">
              <span className="text-sm truncate">
                {row.original.itemReadableId}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {row.original.itemDescription}
              </span>
            </VStack>
          </HStack>
        )
      },
      {
        accessorKey: "description",
        header: t`Operation`,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.description}</span>
        )
      },
      {
        accessorKey: "operationQuantity",
        header: () => <div className="w-full text-right">{t`Qty`}</div>,
        cell: ({ row }) => (
          <div className="w-full text-right tabular-nums">
            {row.original.operationQuantity ?? 0}
          </div>
        )
      },
      {
        accessorKey: "dueDate",
        header: t`Due`,
        cell: ({ row }) => {
          const value = dueDateOf(row.original);
          return value ? (
            <span className="text-sm tabular-nums">
              {formatDate(value, undefined, locale)}
            </span>
          ) : null;
        }
      },
      {
        id: "workCenter",
        header: t`Work Center`,
        cell: ({ row }) =>
          row.original.workCenterId ? (
            <span className="text-sm text-muted-foreground">
              {workCenterNameById.get(row.original.workCenterId) ?? "—"}
            </span>
          ) : null
      },
      {
        id: "materials",
        header: t`Material`,
        cell: ({ row }) => {
          const chips = materialChips(row.original);
          return (
            <HStack spacing={1} className="flex-wrap gap-y-1">
              {chips.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">
                  {t`No materials`}
                </span>
              ) : (
                chips.map((chip) => (
                  <Badge
                    key={chip}
                    variant="outline"
                    className="max-w-[200px] font-normal text-muted-foreground"
                    title={chip}
                  >
                    <span className="truncate">{chip}</span>
                  </Badge>
                ))
              )}
              <CompatBadge candidateId={row.original.id} compat={compat} />
            </HStack>
          );
        }
      }
    ],
    [
      t,
      locale,
      selectedById,
      onToggle,
      allVisibleSelected,
      onToggleAllVisible,
      workCenterNameById,
      compat
    ]
  );

  return (
    <div className="flex-1 min-h-0 overflow-hidden w-full px-4">
      <Table<BatchCandidate>
        compact
        data={visible}
        columns={columns}
        title=""
        withPagination={false}
        withSearch={false}
        withSavedView={false}
        withSimpleSorting={false}
        withSidebarTrigger={false}
        withColumnOrdering={false}
        withCsvExport={false}
        sort={null}
        isFiltered={isFiltered}
        getRowClassName={(row) =>
          selectedById.has(row.id)
            ? "bg-primary/5 transition-colors"
            : "transition-colors"
        }
        emptyState={
          isLoading ? (
            <div className="flex w-full items-center justify-center py-16">
              <Spinner className="size-8" />
            </div>
          ) : isFiltered ? (
            <EmptyState
              icon={<LuPackageSearch className="h-6 w-6" />}
              title={t`No matching operations`}
              hint={t`Nothing here matches your search and filters.`}
            />
          ) : (
            <EmptyState
              icon={<LuPackageSearch className="h-6 w-6" />}
              title={t`No eligible operations`}
              hint={t`No unstarted, unbatched operations on this process at this location.`}
              detail={hiddenSummary}
            />
          )
        }
      />
    </div>
  );
}

function GroupedCandidateList({
  isLoading,
  isFiltered,
  visible,
  hiddenSummary,
  selectedById,
  onToggle,
  onSelectMany,
  onDeselectMany,
  workCenterNameById,
  compat
}: {
  isLoading: boolean;
  isFiltered: boolean;
  visible: BatchCandidate[];
  hiddenSummary: string | null;
  selectedById: Map<string, BatchCandidate>;
  onToggle: (c: BatchCandidate) => void;
  onSelectMany: (cs: BatchCandidate[]) => void;
  onDeselectMany: (cs: BatchCandidate[]) => void;
  workCenterNameById: Map<string, string>;
  compat: CompatInfo;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();

  // Signature sections from the (already filtered/sorted) visible slice.
  // Ungrouped ops render last so the material-driven groups lead.
  const sections = useMemo(() => {
    const bySig = new Map<string, BatchCandidate[]>();
    const ungrouped: BatchCandidate[] = [];
    for (const c of visible) {
      const sig = groupingKey(c, compat.rules);
      if (!sig) {
        ungrouped.push(c);
        continue;
      }
      const g = bySig.get(sig) ?? [];
      g.push(c);
      bySig.set(sig, g);
    }
    const grouped = [...bySig.entries()]
      .map(([sig, members]) => ({
        sig,
        members,
        saving: groupSetupSaving(members)
      }))
      .sort(
        (a, b) => b.saving - a.saving || b.members.length - a.members.length
      );
    return { grouped, ungrouped };
  }, [visible, compat.rules]);

  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 w-full items-center justify-center py-16">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (visible.length === 0) {
    return isFiltered ? (
      <EmptyState
        icon={<LuPackageSearch className="h-6 w-6" />}
        title={t`No matching operations`}
        hint={t`Nothing here matches your search and filters.`}
      />
    ) : (
      <EmptyState
        icon={<LuPackageSearch className="h-6 w-6" />}
        title={t`No eligible operations`}
        hint={t`No unstarted, unbatched operations on this process at this location.`}
        detail={hiddenSummary}
      />
    );
  }

  return (
    // Native scroll, not ScrollArea — its display:table viewport wrapper sizes
    // to content, letting wide rows overflow the panel instead of truncating.
    <div className="flex-1 min-h-0 w-full overflow-y-auto">
      <VStack spacing={4} className="p-4">
        {sections.grouped.map((section) => (
          <CandidateGroup
            key={section.sig}
            title={section.sig}
            saving={section.saving}
            members={section.members}
            selectedById={selectedById}
            onToggle={onToggle}
            onSelectMany={onSelectMany}
            onDeselectMany={onDeselectMany}
            workCenterNameById={workCenterNameById}
            locale={locale}
            compat={compat}
          />
        ))}
        {sections.ungrouped.length > 0 && (
          <CandidateGroup
            title={t`No materials`}
            saving={0}
            members={sections.ungrouped}
            selectedById={selectedById}
            onToggle={onToggle}
            onSelectMany={onSelectMany}
            onDeselectMany={onDeselectMany}
            workCenterNameById={workCenterNameById}
            locale={locale}
            compat={compat}
            muted
          />
        )}
      </VStack>
    </div>
  );
}

function CandidateGroup({
  title,
  saving,
  members,
  selectedById,
  onToggle,
  onSelectMany,
  onDeselectMany,
  workCenterNameById,
  locale,
  compat,
  muted = false
}: {
  title: string;
  saving: number;
  members: BatchCandidate[];
  selectedById: Map<string, BatchCandidate>;
  onToggle: (c: BatchCandidate) => void;
  onSelectMany: (cs: BatchCandidate[]) => void;
  onDeselectMany: (cs: BatchCandidate[]) => void;
  workCenterNameById: Map<string, string>;
  locale: string;
  compat: CompatInfo;
  muted?: boolean;
}) {
  const { t } = useLingui();
  const selectedCount = members.filter((m) => selectedById.has(m.id)).length;
  const allSelected = selectedCount === members.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <VStack spacing={2} className="w-full">
      {/* pl matches a row's border (1px) + padding (10px) so the group
          checkbox sits in the same column as the row checkboxes. */}
      <HStack spacing={3} className="w-full items-center pl-[11px]">
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={() =>
            allSelected ? onDeselectMany(members) : onSelectMany(members)
          }
          aria-label={t`Select group`}
        />
        <HStack spacing={2} className="items-center min-w-0">
          <span
            className={cn(
              "text-sm font-medium truncate",
              muted && "text-muted-foreground italic"
            )}
            title={title}
          >
            {title}
          </span>
          <Count count={members.length} />
          {saving > 0 && (
            <span
              className="flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs tabular-nums text-emerald-600 dark:text-emerald-400"
              title={t`One shared setup instead of one per operation`}
            >
              <LuTimer className="size-3" />
              {t`save ${formatDurationMilliseconds(saving, { style: "short" })}`}
            </span>
          )}
        </HStack>
      </HStack>
      <VStack spacing={1} className="w-full">
        {members.map((c) => {
          const isSelected = selectedById.has(c.id);
          const isLocked = compat.lockedById.has(c.id) && !isSelected;
          const due = dueDateOf(c);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => !isLocked && onToggle(c)}
              disabled={isLocked}
              className={cn(
                "w-full min-w-0 rounded-lg border p-2.5 text-left transition-colors",
                isLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                isSelected
                  ? "border-primary/40 bg-primary/5"
                  : !isLocked && "hover:bg-muted/40"
              )}
            >
              <HStack spacing={3} className="w-full items-center">
                <Checkbox
                  checked={isSelected}
                  disabled={isLocked}
                  className="pointer-events-none flex-shrink-0"
                  tabIndex={-1}
                />
                <ItemThumbnail
                  thumbnailPath={c.thumbnailPath}
                  type="Part"
                  size="sm"
                />
                <VStack spacing={0} className="min-w-0 flex-1">
                  <HStack spacing={2} className="items-baseline">
                    <span className="text-sm font-medium">
                      {c.jobReadableId}
                    </span>
                    <CandidateJobStatus status={c.jobStatus} />
                    <span className="text-xs text-muted-foreground truncate">
                      {c.itemReadableId}
                    </span>
                  </HStack>
                  <span className="text-xs text-muted-foreground truncate">
                    {c.description}
                  </span>
                  <CompatBadge candidateId={c.id} compat={compat} />
                </VStack>
                <VStack
                  spacing={0}
                  className="min-w-0 max-w-[45%] flex-shrink-0 items-end text-right"
                >
                  <span className="text-sm tabular-nums">
                    {c.operationQuantity ?? 0}
                  </span>
                  <span className="max-w-full truncate text-xs text-muted-foreground tabular-nums">
                    {due ? formatDate(due, undefined, locale) : null}
                    {due && c.workCenterId ? " · " : null}
                    {c.workCenterId
                      ? (workCenterNameById.get(c.workCenterId) ?? null)
                      : null}
                  </span>
                </VStack>
              </HStack>
            </button>
          );
        })}
      </VStack>
    </VStack>
  );
}

// Advisory load meter for the selected work center. Purely informational — it
// never blocks Create. Loads = ceil(qty / capacity) whole runs.
function CapacityFill({
  totalQuantity,
  batchCapacity,
  minimumBatchQuantity
}: {
  totalQuantity: number;
  batchCapacity: number;
  minimumBatchQuantity: number | null;
}) {
  const { t } = useLingui();
  const over = totalQuantity > batchCapacity;
  const loads = over
    ? round(totalQuantity / batchCapacity, 0, RoundingMode.Up)
    : 1;
  const pct = Math.min(100, (totalQuantity / batchCapacity) * 100);
  const shortOfMin =
    minimumBatchQuantity != null && totalQuantity < minimumBatchQuantity;

  return (
    <VStack spacing={1} className="items-stretch">
      <div className="h-[5px] w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            over ? "bg-amber-500" : "bg-emerald-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
        <span>
          {over
            ? t`${totalQuantity} / ${batchCapacity} pcs · over capacity — ${loads} loads of ${batchCapacity}`
            : t`${totalQuantity} / ${batchCapacity} pcs · fits in one run`}
        </span>
        {minimumBatchQuantity != null ? (
          <span
            className={cn(shortOfMin && "text-amber-600 dark:text-amber-400")}
          >
            {shortOfMin
              ? t`min ${minimumBatchQuantity} — short`
              : t`min ${minimumBatchQuantity} — met`}
          </span>
        ) : null}
      </div>
    </VStack>
  );
}

function ReviewPanel({
  isAddMode,
  existingMembers,
  selected,
  rules,
  batchType,
  onRemove,
  workCenterId,
  workCenterOptions,
  onWorkCenterChange,
  batchCapacity,
  minimumBatchQuantity,
  notes,
  onNotesChange
}: {
  isAddMode: boolean;
  existingMembers: BatchBuilderBatch["members"];
  selected: BatchCandidate[];
  rules: Required<BatchRules>;
  batchType: BatchType;
  onRemove: (c: BatchCandidate) => void;
  workCenterId: string | null;
  workCenterOptions: {
    value: string;
    label: string;
    helper?: string;
  }[];
  onWorkCenterChange: (id: string | null) => void;
  batchCapacity: number | null;
  minimumBatchQuantity: number | null;
  notes: string;
  onNotesChange: (v: string) => void;
}) {
  const { t } = useLingui();

  // Planned durations for the batch, by type: one shared setup (the largest
  // member) plus labor/machine per the process's batch type — summed for
  // Sequential, the largest member for Simultaneous. The estimate is their sum.
  const plan = batchPlanBreakdown(selected, undefined, batchType);
  const estimateMs = plan.setup + plan.labor + plan.machine;

  // Setup saving: one shared setup (the largest member) instead of the sum.
  const setupMax = plan.setup;
  const setupSaving = groupSetupSaving(selected);
  const setupSum = setupMax + setupSaving;
  const showSetupSaving = setupSaving > 0;

  const totalQuantity = selected.reduce(
    (s, c) => s + (c.operationQuantity ?? 0),
    0
  );

  // Due spread across selected members (op due date, falling back to job due).
  const dueDates = selected
    .map(dueDateOf)
    .filter((d): d is string => Boolean(d))
    .map((d) => parseDate(d));
  const dueSpreadDays =
    dueDates.length >= 2
      ? Math.abs(
          dueDates
            .reduce((max, d) => (d.compare(max) > 0 ? d : max))
            .compare(
              dueDates.reduce((min, d) => (d.compare(min) < 0 ? d : min))
            )
        )
      : 0;
  const showDueSpread = dueSpreadDays >= DUE_SPREAD_WARNING_DAYS;

  // Mixed materials: distinct non-empty signatures among the selection.
  const signatures = [
    ...new Set(selected.map((c) => materialSignature(c, rules)).filter(Boolean))
  ];
  const showMixedWarning = signatures.length >= 2;

  return (
    <VStack spacing={0} className="h-full min-h-0 overflow-hidden bg-card">
      <PanelHeading
        step={3}
        active={selected.length > 0}
        right={selected.length > 0 ? <Count count={selected.length} /> : null}
      >
        <Trans>Review & create</Trans>
      </PanelHeading>

      <VStack
        spacing={2}
        className="px-4 py-3 border-b w-full flex-shrink-0 items-stretch"
      >
        <span className="text-sm text-muted-foreground tabular-nums">
          {selected.length === 0 ? (
            <Trans>Nothing selected yet</Trans>
          ) : (
            <>
              <Trans>
                {selected.length} operations · {totalQuantity} parts
              </Trans>
              {estimateMs > 0 && (
                <>
                  {" · "}
                  <span
                    title={
                      batchType === "Simultaneous"
                        ? t`One shared setup plus the longest labor and machine time — the members run together`
                        : t`One shared setup plus the summed labor and machine time`
                    }
                  >
                    {t`≈ ${formatDurationMilliseconds(estimateMs, {
                      style: "short"
                    })}`}
                  </span>
                </>
              )}
            </>
          )}
        </span>
        {showSetupSaving && (
          <span
            className="flex items-center gap-1 self-start rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs tabular-nums text-emerald-600 dark:text-emerald-400"
            title={t`One shared setup instead of one per operation`}
          >
            <LuTimer className="size-3" />
            {t`Setup ${formatDurationMilliseconds(setupSum, {
              style: "short"
            })} → ${formatDurationMilliseconds(setupMax, { style: "short" })}`}
          </span>
        )}
        {showDueSpread && (
          <span
            className="flex items-center gap-1 self-start rounded-full bg-amber-500/10 px-2 py-0.5 text-xs tabular-nums text-amber-600 dark:text-amber-400"
            title={t`The batch runs at its most urgent member's time — the others are pulled early`}
          >
            <LuCalendarClock className="size-3" />
            {t`Due dates span ${dueSpreadDays} days`}
          </span>
        )}
        {showMixedWarning && (
          <HStack
            spacing={1}
            className="items-start rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400"
          >
            <LuTriangleAlert className="size-3.5 flex-shrink-0 mt-0.5" />
            <span>
              {t`Mixing materials: ${signatures
                .slice(0, 3)
                .join(
                  ", "
                )}${signatures.length > 3 ? "…" : ""}. Confirm they nest together on this run.`}
            </span>
          </HStack>
        )}
      </VStack>

      {!isAddMode && (
        <VStack
          spacing={2}
          className="px-4 py-3 border-b w-full flex-shrink-0 items-stretch"
        >
          <Combobox
            size="sm"
            value={workCenterId ?? ""}
            options={workCenterOptions}
            onChange={(id) => onWorkCenterChange(id || null)}
            isClearable
            placeholder={t`Work center (optional)`}
          />
          {workCenterId && batchCapacity ? (
            <CapacityFill
              totalQuantity={totalQuantity}
              batchCapacity={batchCapacity}
              minimumBatchQuantity={minimumBatchQuantity}
            />
          ) : null}
          <Input
            size="sm"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={t`Notes (optional)`}
          />
        </VStack>
      )}

      <div className="flex-1 min-h-0 w-full overflow-y-auto">
        <VStack spacing={0} className="p-3">
          {isAddMode &&
            existingMembers.map((m) => (
              <HStack
                key={m.id}
                className="w-full justify-between gap-2 rounded-md p-2 opacity-60"
              >
                <VStack spacing={0} className="min-w-0">
                  <span className="text-sm font-medium truncate">
                    {m.jobReadableId}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {m.itemReadableId ?? m.description}
                  </span>
                </VStack>
                <Badge variant="outline">
                  <Trans>Member</Trans>
                </Badge>
              </HStack>
            ))}
          {selected.length === 0 && !isAddMode && (
            <EmptyState
              icon={<LuLayers className="h-6 w-6" />}
              title={t`No operations selected`}
              hint={t`Check operations on the left to build the batch.`}
            />
          )}
          {selected.map((c) => (
            <HStack
              key={c.id}
              className="w-full justify-between gap-2 rounded-md p-2 hover:bg-muted/50"
            >
              <HStack spacing={2} className="min-w-0">
                <ItemThumbnail
                  thumbnailPath={c.thumbnailPath}
                  type="Part"
                  size="sm"
                />
                <VStack spacing={0} className="min-w-0">
                  <span className="text-sm font-medium truncate">
                    {c.jobReadableId}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {c.itemReadableId ?? c.description}
                  </span>
                </VStack>
              </HStack>
              <HStack spacing={2} className="flex-shrink-0">
                <span className="min-w-[3ch] text-right text-xs tabular-nums text-muted-foreground">
                  {c.operationQuantity ?? 0}
                </span>
                <IconButton
                  aria-label={t`Remove`}
                  variant="ghost"
                  size="sm"
                  icon={<LuX />}
                  onClick={() => onRemove(c)}
                />
              </HStack>
            </HStack>
          ))}
        </VStack>
      </div>
    </VStack>
  );
}

function EmptyState({
  icon,
  title,
  hint,
  detail
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  detail?: string | null;
}) {
  return (
    <VStack
      spacing={4}
      className="w-full items-center justify-center py-16 px-6 text-center"
    >
      <div className="flex justify-center items-center h-12 w-12 rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <span className="text-xs font-mono font-light text-foreground uppercase">
        {title}
      </span>
      {hint && (
        <span className="text-xs text-muted-foreground max-w-[32ch] text-balance">
          {hint}
        </span>
      )}
      {detail && (
        <span className="text-xs font-medium text-foreground max-w-[40ch] text-balance">
          {detail}
        </span>
      )}
    </VStack>
  );
}
