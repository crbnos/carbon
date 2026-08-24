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
  toast,
  useLocalStorage,
  VStack
} from "@carbon/react";
import { formatDate, formatDurationMilliseconds } from "@carbon/utils";
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
  LuPackageSearch,
  LuPlus,
  LuSearch,
  LuTimer,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { ItemThumbnail, Table } from "~/components";
import { makeDurations } from "~/utils/duration";
import { path } from "~/utils/path";
import type { BatchCandidate, BatchMaterial } from "../../types";

// The candidate list is fetched whole (no server paging) and neither view
// virtualizes, so cap the DOM and say so when truncated.
const MAX_VISIBLE = 250;

// Warn when the chosen operations couple due dates further apart than this: the
// batch runs at its most-urgent member's time, so the rest is pulled early.
const DUE_SPREAD_WARNING_DAYS = 7;

const DUE_WINDOWS = [7, 14, 30] as const;

// The five normalized material-property dimensions. The builder also derives a
// `material` dimension (the BOM item itself) — see facetDimensions.
const PROPERTY_FACETS: {
  key: keyof BatchMaterial;
  nameKey: keyof BatchMaterial;
}[] = [
  { key: "substanceId", nameKey: "substanceName" },
  { key: "gradeId", nameKey: "gradeName" },
  { key: "dimensionId", nameKey: "dimensionName" },
  { key: "formId", nameKey: "formName" },
  { key: "finishId", nameKey: "finishName" }
];

const MATERIAL_FACET_KEY = "material";

type FacetDimension = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

// Does one BOM line satisfy one facet dimension's selected values?
function lineMatchesFacet(
  line: BatchMaterial,
  key: string,
  values: string[]
): boolean {
  if (key === MATERIAL_FACET_KEY) {
    return !!line.itemReadableId && values.includes(line.itemReadableId);
  }
  return values.includes(line[key as keyof BatchMaterial] as string);
}

// One BOM line's display/grouping string: the normalized properties when they
// exist, else the material item itself — BOMs without normalized material
// properties still group and read by what they actually consume.
function lineSignature(line: BatchMaterial): string | null {
  const props = [line.substanceName, line.gradeName, line.dimensionName]
    .filter(Boolean)
    .join(" · ");
  return props || line.itemReadableId || null;
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

// A candidate's material signature: the sorted set of its BOM lines'
// signatures (see lineSignature). Two candidates with the same signature are
// nesting-compatible and can be grouped/suggested as a batch.
function candidateSignature(candidate: BatchCandidate): string {
  const sigs = new Set<string>();
  for (const m of candidate.materials ?? []) {
    const s = lineSignature(m);
    if (s) sigs.add(s);
  }
  return [...sigs].sort().join(" + ");
}

function setupDurationOf(candidate: BatchCandidate): number {
  return makeDurations({
    setupTime: candidate.setupTime ?? 0,
    setupUnit: candidate.setupUnit ?? undefined,
    operationQuantity: candidate.operationQuantity
  }).setupDuration;
}

// Batching shares ONE setup (the largest member's) — the saving is the rest.
function groupSetupSaving(members: BatchCandidate[]): number {
  if (members.length < 2) return 0;
  const setups = members.map(setupDurationOf);
  const sum = setups.reduce((acc, s) => acc + s, 0);
  const max = Math.max(0, ...setups);
  return max > 0 && sum > max ? sum - max : 0;
}

// Estimated batch run time: one shared setup (largest), labor and machine summed.
function batchEstimateMs(members: BatchCandidate[]): number {
  let setupMax = 0;
  let laborSum = 0;
  let machineSum = 0;
  for (const c of members) {
    const d = makeDurations({
      setupTime: c.setupTime ?? 0,
      setupUnit: c.setupUnit ?? undefined,
      laborTime: c.laborTime ?? 0,
      laborUnit: c.laborUnit ?? undefined,
      machineTime: c.machineTime ?? 0,
      machineUnit: c.machineUnit ?? undefined,
      operationQuantity: c.operationQuantity
    });
    setupMax = Math.max(setupMax, d.setupDuration);
    laborSum += d.laborDuration;
    machineSum += d.machineDuration;
  }
  return setupMax + laborSum + machineSum;
}

function dueDateOf(candidate: BatchCandidate): string | null {
  return candidate.dueDate ?? candidate.jobDueDate;
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
  unreleased: number;
  started: number;
  batched: number;
};

const NO_HIDDEN_OPS: HiddenOps = {
  total: 0,
  unreleased: 0,
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
  processes: { id: string; name: string }[];
  workCenters: {
    id: string;
    name: string;
    locationId: string | null;
    processes: string[];
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
  const workCenterLoad = candidatesFetcher.data?.workCenterLoad ?? {};
  const hidden = candidatesFetcher.data?.hidden ?? NO_HIDDEN_OPS;

  // "6 hidden" alone reads as a bug when the list is empty — name the reasons.
  const hiddenParts = [
    hidden.unreleased > 0
      ? t`${hidden.unreleased} on jobs not yet released`
      : null,
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
  const addTargets = useMemo(() => {
    const targets = new Map<
      string,
      { batchId: string; readableId: string; memberCount: number }
    >();
    for (const c of allCandidates) {
      if (!c.jobOperationBatchId || c.batchStatus !== "Active") continue;
      const entry = targets.get(c.jobOperationBatchId) ?? {
        batchId: c.jobOperationBatchId,
        readableId: c.batchReadableId ?? "Batch",
        memberCount: 0
      };
      entry.memberCount += 1;
      targets.set(c.jobOperationBatchId, entry);
    }
    return [...targets.values()].sort((a, b) =>
      a.readableId.localeCompare(b.readableId)
    );
  }, [allCandidates]);

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
    const dims: FacetDimension[] = [];

    const materialItems = new Map<string, string>();
    for (const c of candidates) {
      for (const m of c.materials ?? []) {
        if (m.itemReadableId && !materialItems.has(m.itemReadableId)) {
          materialItems.set(m.itemReadableId, m.itemReadableId);
        }
      }
    }
    if (materialItems.size > 0) {
      dims.push({
        key: MATERIAL_FACET_KEY,
        label: labels[MATERIAL_FACET_KEY],
        options: [...materialItems.keys()]
          .sort((a, b) => a.localeCompare(b))
          .map((id) => ({ value: id, label: id }))
      });
    }

    for (const f of PROPERTY_FACETS) {
      const seen = new Map<string, string>();
      for (const c of candidates) {
        for (const m of c.materials ?? []) {
          const id = m[f.key] as string | null;
          const name = m[f.nameKey] as string | null;
          if (id && name && !seen.has(id)) seen.set(id, name);
        }
      }
      if (seen.size > 0) {
        dims.push({
          key: f.key,
          label: labels[f.key],
          options: [...seen.entries()]
            .map(([id, name]) => ({ value: id, label: name }))
            .sort((a, b) => a.label.localeCompare(b.label))
        });
      }
    }
    return dims;
  }, [candidates, t]);

  const activeFacetKeys = useMemo(
    () => Object.keys(facets).filter((k) => (facets[k]?.length ?? 0) > 0),
    [facets]
  );

  // A candidate matches if ANY BOM line satisfies ALL active facets, the search
  // term matches its job/item/op text, and it falls inside the due window.
  // Sorted most-urgent first (due date asc, undated last).
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const dueLimit =
      dueWindow !== null
        ? today(getLocalTimeZone()).add({ days: dueWindow })
        : null;
    const matches = candidates.filter((c) => {
      if (activeFacetKeys.length > 0) {
        const anyLineMatches = (c.materials ?? []).some((m) =>
          activeFacetKeys.every((key) => lineMatchesFacet(m, key, facets[key]))
        );
        if (!anyLineMatches) return false;
      }
      if (dueLimit) {
        const due = dueDateOf(c);
        if (!due || parseDate(due).compare(dueLimit) > 0) return false;
      }
      if (term) {
        const haystack = [
          c.jobReadableId,
          c.itemReadableId,
          c.itemDescription,
          c.description
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
    return matches.sort((a, b) => {
      const da = dueDateOf(a);
      const db = dueDateOf(b);
      if (da && db) return parseDate(da).compare(parseDate(db));
      if (da) return -1;
      if (db) return 1;
      return 0;
    });
  }, [candidates, activeFacetKeys, facets, search, dueWindow]);

  const visible = useMemo(() => filtered.slice(0, MAX_VISIBLE), [filtered]);

  // Suggested batches: groups of ≥2 unselected candidates sharing a material
  // signature, ranked by the setup time batching them would save. One click
  // merges the group into the selection. (Table view only — the grouped view's
  // sections carry the same information.)
  const suggestions = useMemo(() => {
    const groups = new Map<string, BatchCandidate[]>();
    for (const c of candidates) {
      if (selectedById.has(c.id)) continue;
      const sig = candidateSignature(c);
      if (!sig) continue;
      const g = groups.get(sig) ?? [];
      g.push(c);
      groups.set(sig, g);
    }
    return [...groups.entries()]
      .filter(([, g]) => g.length >= 2)
      .map(([sig, g]) => ({
        sig,
        members: g,
        saving: groupSetupSaving(g)
      }))
      .sort(
        (a, b) => b.saving - a.saving || b.members.length - a.members.length
      )
      .slice(0, 6);
  }, [candidates, selectedById]);

  const toggle = useCallback((candidate: BatchCandidate) => {
    setSelectedById((prev) => {
      const next = new Map(prev);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.set(candidate.id, candidate);
      return next;
    });
  }, []);

  const selectMany = useCallback((toAdd: BatchCandidate[]) => {
    setSelectedById((prev) => {
      const next = new Map(prev);
      for (const c of toAdd) next.set(c.id, c);
      return next;
    });
  }, []);

  const deselectMany = useCallback((toRemove: BatchCandidate[]) => {
    setSelectedById((prev) => {
      const next = new Map(prev);
      for (const c of toRemove) next.delete(c.id);
      return next;
    });
  }, []);

  const allVisibleSelected =
    visible.length > 0 && visible.every((c) => selectedById.has(c.id));
  const toggleAllVisible = useCallback(() => {
    setSelectedById((prev) => {
      const next = new Map(prev);
      const shouldSelect = !visible.every((c) => next.has(c.id));
      for (const c of visible) {
        if (shouldSelect) next.set(c.id, c);
        else next.delete(c.id);
      }
      return next;
    });
  }, [visible]);

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

  const submit = (targetBatchId?: string) => {
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
    }
    for (const id of selectedById.keys()) fd.append("jobOperationIds", id);
    submitFetcher.submit(fd, {
      method: "post",
      action: path.to.scheduleBatchingUpdate
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
              />
            )
          }
          right={
            <ReviewPanel
              isAddMode={isAddMode}
              existingMembers={batch?.members ?? []}
              selected={selected}
              onRemove={toggle}
              workCenterId={workCenterId}
              workCenterOptions={workCenterOptions}
              onWorkCenterChange={setWorkCenterId}
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
            <Button
              leftIcon={<LuLayers />}
              isLoading={isSubmitting}
              isDisabled={selected.length === 0 || isSubmitting}
              onClick={() => submit()}
            >
              {isAddMode
                ? t`Add ${selected.length} operations`
                : t`Create batch (${selected.length})`}
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
  workCenterNameById
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
  suggestions: { sig: string; members: BatchCandidate[]; saving: number }[];
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
          <HStack spacing={2} className="flex-wrap items-center">
            <span className="text-xs text-muted-foreground">
              <Trans>Suggested</Trans>
            </span>
            {suggestions.map((s) => (
              <Button
                key={s.sig}
                size="sm"
                variant="secondary"
                leftIcon={<LuLayers className="size-3" />}
                onClick={() => onApplySuggestion(s.members)}
                title={s.sig}
              >
                <span className="tabular-nums">{s.members.length}</span>
                <span className="mx-1">·</span>
                <span className="max-w-[160px] truncate">{s.sig}</span>
                {s.saving > 0 && (
                  <span className="ml-1.5 text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                    {t`save ${formatDurationMilliseconds(s.saving, {
                      style: "short"
                    })}`}
                  </span>
                )}
              </Button>
            ))}
          </HStack>
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
  workCenterNameById
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
        cell: ({ row }) => (
          <button
            type="button"
            className="flex items-center cursor-pointer p-3 -m-3"
            onClick={() => onToggle(row.original)}
            aria-label={t`Select operation`}
          >
            <Checkbox
              checked={selectedById.has(row.original.id)}
              className="pointer-events-none"
              tabIndex={-1}
            />
          </button>
        )
      },
      {
        accessorKey: "jobReadableId",
        header: t`Job`,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.jobReadableId}</span>
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
          if (chips.length === 0)
            return (
              <span className="text-xs text-muted-foreground italic">
                {t`No materials`}
              </span>
            );
          return (
            <HStack spacing={1} className="flex-wrap gap-y-1">
              {chips.map((chip) => (
                <Badge
                  key={chip}
                  variant="outline"
                  className="max-w-[200px] font-normal text-muted-foreground"
                  title={chip}
                >
                  <span className="truncate">{chip}</span>
                </Badge>
              ))}
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
      workCenterNameById
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
  workCenterNameById
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
}) {
  const { t } = useLingui();
  const { locale } = useLocale();

  // Signature sections from the (already filtered/sorted) visible slice.
  // Ungrouped ops render last so the material-driven groups lead.
  const sections = useMemo(() => {
    const bySig = new Map<string, BatchCandidate[]>();
    const ungrouped: BatchCandidate[] = [];
    for (const c of visible) {
      const sig = candidateSignature(c);
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
  }, [visible]);

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
          const due = dueDateOf(c);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c)}
              className={cn(
                "w-full min-w-0 rounded-lg border p-2.5 text-left transition-colors cursor-pointer",
                isSelected
                  ? "border-primary/40 bg-primary/5"
                  : "hover:bg-muted/40"
              )}
            >
              <HStack spacing={3} className="w-full items-center">
                <Checkbox
                  checked={isSelected}
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
                    <span className="text-xs text-muted-foreground truncate">
                      {c.itemReadableId}
                    </span>
                  </HStack>
                  <span className="text-xs text-muted-foreground truncate">
                    {c.description}
                  </span>
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

function ReviewPanel({
  isAddMode,
  existingMembers,
  selected,
  onRemove,
  workCenterId,
  workCenterOptions,
  onWorkCenterChange,
  notes,
  onNotesChange
}: {
  isAddMode: boolean;
  existingMembers: BatchBuilderBatch["members"];
  selected: BatchCandidate[];
  onRemove: (c: BatchCandidate) => void;
  workCenterId: string | null;
  workCenterOptions: {
    value: string;
    label: string;
    helper?: string;
  }[];
  onWorkCenterChange: (id: string | null) => void;
  notes: string;
  onNotesChange: (v: string) => void;
}) {
  const { t } = useLingui();

  // Setup saving: one shared setup (the largest member) instead of the sum.
  const setups = selected.map(setupDurationOf);
  const setupSum = setups.reduce((acc, s) => acc + s, 0);
  const setupMax = Math.max(0, ...setups);
  const showSetupSaving = setupMax > 0 && setupSum > setupMax;

  const estimateMs = batchEstimateMs(selected);
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
    ...new Set(selected.map(candidateSignature).filter(Boolean))
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
                    title={t`One shared setup plus the summed labor and machine time`}
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
