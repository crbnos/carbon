import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  Count,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Heading,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  MultiSelect,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { formatDate, formatDurationMilliseconds } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCalendarClock,
  LuLayers,
  LuPackageSearch,
  LuSearch,
  LuTimer,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { Table } from "~/components";
import { makeDurations } from "~/utils/duration";
import { path } from "~/utils/path";
import type { BatchCandidate, BatchMaterial } from "../../types";

// The candidate list is fetched whole (no server paging) and the shared Table
// doesn't virtualize, so cap the DOM and say so when truncated.
const MAX_VISIBLE = 250;

// Warn when the chosen operations couple due dates further apart than this: the
// batch runs at its most-urgent member's time, so the rest is pulled early.
const DUE_SPREAD_WARNING_DAYS = 7;

const FACETS: { key: keyof BatchMaterial; header: string }[] = [
  { key: "substanceId", header: "Substance" },
  { key: "gradeId", header: "Grade" },
  { key: "dimensionId", header: "Dimension" },
  { key: "formId", header: "Form" },
  { key: "finishId", header: "Finish" }
];

const FACET_NAME: Record<string, keyof BatchMaterial> = {
  substanceId: "substanceName",
  gradeId: "gradeName",
  dimensionId: "dimensionName",
  formId: "formName",
  finishId: "finishName"
};

// The material chips shown on a candidate row: one per distinct BOM-line
// substance·grade·dimension·form·finish string.
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
    if (parts.length) chips.add(parts.join(" "));
  }
  return [...chips];
}

// A candidate's material signature: the sorted set of its BOM lines'
// substance·grade·dimension strings. Two candidates with the same signature are
// nesting-compatible and can be suggested as a batch.
function candidateSignature(candidate: BatchCandidate): string {
  const sigs = new Set<string>();
  for (const m of candidate.materials ?? []) {
    const s = [m.substanceName, m.gradeName, m.dimensionName]
      .filter(Boolean)
      .join(" · ");
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

export function BatchBuilder({
  onClose,
  defaultLocationId,
  locations,
  processes,
  workCenters,
  batch
}: {
  onClose: () => void;
  defaultLocationId: string;
  locations: { id: string; name: string }[];
  processes: { id: string; name: string }[];
  workCenters: { id: string; name: string }[];
  batch?: BatchBuilderBatch | null;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();

  const isAddMode = !!batch;

  const [locationId, setLocationId] = useState(
    batch?.locationId ?? defaultLocationId
  );
  const [processId, setProcessId] = useState<string | null>(
    batch?.processId ?? null
  );
  const [search, setSearch] = useState("");
  const [facets, setFacets] = useState<Record<string, string[]>>({});
  const [workCenterId, setWorkCenterId] = useState<string | null>(null);

  // Selection is held here (not via the Table's index-keyed rowSelection, which
  // resets when the filtered data length changes) so the full candidate object
  // survives even while filtered out of view.
  const [selectedById, setSelectedById] = useState<Map<string, BatchCandidate>>(
    new Map()
  );

  const candidatesFetcher = useFetcher<{ candidates: BatchCandidate[] }>();
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
    setWorkCenterId(null);
  }, []);

  const workCenterNameById = useMemo(
    () => new Map(workCenters.map((wc) => [wc.id, wc.name] as const)),
    [workCenters]
  );

  // Only unbatched operations are addable; the current batch's members (add
  // mode) are shown separately, locked.
  const allCandidates = candidatesFetcher.data?.candidates ?? [];
  const candidates = useMemo(
    () => allCandidates.filter((c) => !c.jobOperationBatchId),
    [allCandidates]
  );

  const facetOptions = useMemo(() => {
    return Object.fromEntries(
      FACETS.map((f) => {
        const nameKey = FACET_NAME[f.key];
        const seen = new Map<string, string>();
        for (const c of candidates) {
          for (const m of c.materials ?? []) {
            const id = m[f.key] as string | null;
            const name = m[nameKey] as string | null;
            if (id && name && !seen.has(id)) seen.set(id, name);
          }
        }
        return [
          f.key,
          [...seen.entries()]
            .map(([id, name]) => ({ value: id, label: name }))
            .sort((a, b) => a.label.localeCompare(b.label))
        ];
      })
    ) as Record<string, { value: string; label: string }[]>;
  }, [candidates]);

  const activeFacetKeys = useMemo(
    () => Object.keys(facets).filter((k) => (facets[k]?.length ?? 0) > 0),
    [facets]
  );

  // A candidate matches if ANY BOM line satisfies ALL active facets, and the
  // search term matches its job/item/op text.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (activeFacetKeys.length > 0) {
        const anyLineMatches = (c.materials ?? []).some((m) =>
          activeFacetKeys.every((key) =>
            facets[key].includes(m[key as keyof BatchMaterial] as string)
          )
        );
        if (!anyLineMatches) return false;
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
  }, [candidates, activeFacetKeys, facets, search]);

  const visible = useMemo(() => filtered.slice(0, MAX_VISIBLE), [filtered]);

  // Suggested batches: groups of ≥2 unselected candidates sharing a material
  // signature. One click merges the group into the selection.
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
      .map(([sig, g]) => ({ sig, members: g }))
      .sort((a, b) => b.members.length - a.members.length)
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

  // Toast on submit failure; navigate on success.
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
      const targetId = isAddMode ? batch?.id : data.batchId;
      if (targetId) navigate(path.to.operationBatch(targetId));
      else navigate(path.to.operationBatches);
    }
  }, [submitFetcher.state, submitFetcher.data, isAddMode, batch?.id, navigate]);

  const submit = () => {
    const fd = new FormData();
    if (isAddMode) {
      fd.set("intent", "add");
      fd.set("batchId", batch.id);
    } else {
      fd.set("intent", "create");
      fd.set("locationId", locationId);
      if (workCenterId) fd.set("workCenterId", workCenterId);
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
  const workCenterOptions = useMemo(
    () => workCenters.map((wc) => ({ value: wc.id, label: wc.name })),
    [workCenters]
  );

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
              onLocationChange={(id) => {
                setLocationId(id);
                resetComposition();
              }}
              onProcessChange={(id) => {
                setProcessId(id);
                resetComposition();
              }}
            />
          }
          left={
            !processId ? (
              <EmptyState
                icon={<LuLayers className="h-6 w-6" />}
                title={t`Pick a process to start`}
                hint={t`Choose a batchable process to see the operations that can run together.`}
              />
            ) : (
              <ComposePanel
                isLoading={isLoading}
                search={search}
                onSearchChange={setSearch}
                facets={facets}
                facetOptions={facetOptions}
                onFacetChange={(key, values) =>
                  setFacets((prev) => ({ ...prev, [key]: values }))
                }
                suggestions={suggestions}
                onApplySuggestion={selectMany}
                visible={visible}
                totalFiltered={filtered.length}
                selectedById={selectedById}
                onToggle={toggle}
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
            />
          }
        />

        <DrawerFooter className="flex-shrink-0 border-t bg-card sm:justify-between items-center">
          <span className="text-sm text-muted-foreground tabular-nums">
            {selected.length === 0 ? (
              <Trans>No operations selected</Trans>
            ) : (
              <Trans>
                {selected.length} operations ·{" "}
                {selected.reduce((s, c) => s + (c.operationQuantity ?? 0), 0)}{" "}
                parts
              </Trans>
            )}
          </span>
          <HStack spacing={2}>
            <Button
              variant="ghost"
              isDisabled={selected.length === 0 || isSubmitting}
              onClick={() => setSelectedById(new Map())}
            >
              {t`Clear`}
            </Button>
            <Button
              leftIcon={<LuLayers />}
              isLoading={isSubmitting}
              isDisabled={selected.length === 0 || isSubmitting}
              onClick={submit}
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
      <div className="w-[220px]">
        <Combobox
          size="sm"
          value={locationId}
          options={locationOptions}
          onChange={onLocationChange}
          placeholder={t`Location`}
        />
      </div>
      <div className="w-[240px]">
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

function ComposePanel({
  isLoading,
  search,
  onSearchChange,
  facets,
  facetOptions,
  onFacetChange,
  suggestions,
  onApplySuggestion,
  visible,
  totalFiltered,
  selectedById,
  onToggle,
  allVisibleSelected,
  onToggleAllVisible,
  workCenterNameById
}: {
  isLoading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  facets: Record<string, string[]>;
  facetOptions: Record<string, { value: string; label: string }[]>;
  onFacetChange: (key: string, values: string[]) => void;
  suggestions: { sig: string; members: BatchCandidate[] }[];
  onApplySuggestion: (members: BatchCandidate[]) => void;
  visible: BatchCandidate[];
  totalFiltered: number;
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
        header: () => (
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={onToggleAllVisible}
            aria-label={t`Select all`}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedById.has(row.original.id)}
            onCheckedChange={() => onToggle(row.original)}
            aria-label={t`Select operation`}
          />
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
          <VStack spacing={0} className="min-w-0">
            <span className="text-sm truncate">
              {row.original.itemReadableId}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {row.original.itemDescription}
            </span>
          </VStack>
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
        header: t`Qty`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.operationQuantity ?? 0}
          </span>
        )
      },
      {
        accessorKey: "dueDate",
        header: t`Due`,
        cell: ({ row }) => {
          const value = row.original.dueDate ?? row.original.jobDueDate;
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
                {t`No material properties`}
              </span>
            );
          return (
            <HStack spacing={1} className="flex-wrap">
              {chips.map((chip) => (
                <Badge key={chip} variant="secondary">
                  {chip}
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

  const isFiltered =
    search.trim().length > 0 || Object.values(facets).some((v) => v.length > 0);

  return (
    <VStack spacing={0} className="h-full min-h-0 overflow-hidden bg-card">
      <VStack
        spacing={2}
        className="px-4 py-3 border-b w-full flex-shrink-0 items-stretch"
      >
        <HStack spacing={2} className="flex-wrap items-center">
          <InputGroup size="sm" className="w-[200px]">
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
          {FACETS.filter((f) => (facetOptions[f.key]?.length ?? 0) > 0).map(
            (f) => (
              <div key={f.key} className="w-[160px]">
                <MultiSelect
                  size="sm"
                  value={facets[f.key] ?? []}
                  options={facetOptions[f.key] ?? []}
                  onChange={(values) => onFacetChange(f.key, values)}
                  isClearable
                  placeholder={f.header}
                />
              </div>
            )
          )}
        </HStack>
        {suggestions.length > 0 && (
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
              </Button>
            ))}
          </HStack>
        )}
      </VStack>

      <div className="flex-1 min-h-0 overflow-hidden w-full px-4">
        <Table<BatchCandidate>
          compact
          data={visible}
          columns={columns}
          title={t`Operations`}
          withPagination={false}
          withSearch={false}
          withSavedView={false}
          withSimpleSorting={false}
          withSidebarTrigger={false}
          sort={null}
          isFiltered={isFiltered}
          emptyState={
            isLoading ? null : isFiltered ? (
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
              />
            )
          }
        />
        {totalFiltered > visible.length && (
          <p className="text-xs text-muted-foreground pb-3">
            <Trans>
              Showing {visible.length} of {totalFiltered} — refine your search
            </Trans>
          </p>
        )}
      </div>
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
  onWorkCenterChange
}: {
  isAddMode: boolean;
  existingMembers: BatchBuilderBatch["members"];
  selected: BatchCandidate[];
  onRemove: (c: BatchCandidate) => void;
  workCenterId: string | null;
  workCenterOptions: { value: string; label: string }[];
  onWorkCenterChange: (id: string | null) => void;
}) {
  const { t } = useLingui();
  // Setup saving: one shared setup (the largest member) instead of the sum.
  const setups = selected.map(setupDurationOf);
  const setupSum = setups.reduce((acc, s) => acc + s, 0);
  const setupMax = Math.max(0, ...setups);
  const showSetupSaving = setupMax > 0 && setupSum > setupMax;

  // Due spread across selected members (op due date, falling back to job due).
  const dueDates = selected
    .map((c) => c.dueDate ?? c.jobDueDate)
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
      <HStack
        spacing={2}
        className="px-4 py-3 border-b w-full flex-shrink-0 items-center justify-between"
      >
        <Heading size="h4">
          <Trans>Selected</Trans>
        </Heading>
        {selected.length > 0 && <Count count={selected.length} />}
      </HStack>

      {(showSetupSaving || showDueSpread || showMixedWarning) && (
        <VStack
          spacing={2}
          className="px-4 py-3 border-b w-full flex-shrink-0 items-stretch"
        >
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
      )}

      {!isAddMode && (
        <div className="px-4 py-3 border-b w-full flex-shrink-0">
          <Combobox
            size="sm"
            value={workCenterId ?? ""}
            options={workCenterOptions}
            onChange={(id) => onWorkCenterChange(id || null)}
            isClearable
            placeholder={t`Work center (optional)`}
          />
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0 w-full">
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
              <VStack spacing={0} className="min-w-0">
                <span className="text-sm font-medium truncate">
                  {c.jobReadableId}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {c.itemReadableId ?? c.description}
                </span>
              </VStack>
              <HStack spacing={2} className="flex-shrink-0">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {c.operationQuantity ?? 0}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(c)}
                  aria-label={t`Remove`}
                >
                  <LuX className="size-3.5" />
                </Button>
              </HStack>
            </HStack>
          ))}
        </VStack>
      </ScrollArea>
    </VStack>
  );
}

function EmptyState({
  icon,
  title,
  hint
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
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
        <span className="text-xs text-muted-foreground max-w-[32ch]">
          {hint}
        </span>
      )}
    </VStack>
  );
}
