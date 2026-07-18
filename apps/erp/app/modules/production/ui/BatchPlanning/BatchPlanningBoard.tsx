import { Badge, Button, cn, Heading, HStack, VStack } from "@carbon/react";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuLayers, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { BatchOperationMaterial } from "~/modules/production";

// The batch planning board. Left: the candidate pool (unstarted, unbatched
// operations on batchable processes) grouped by material facet + facet-filtered.
// Right: a "New batch" drop zone and one lane per Active batch. Dragging a
// candidate onto "New batch" creates a batch; onto a lane adds it; dragging a
// member back to the pool removes it. The batch-operations edge function owns
// every eligibility rule — the board just posts intents and re-reads.

const FACETS = ["substance", "grade", "dimension", "finish", "form"] as const;
type Facet = (typeof FACETS)[number];

type BatchCandidate = {
  id: string;
  jobId: string;
  jobReadableId: string | null;
  processId: string | null;
  processName: string | null;
  description: string | null;
  operationQuantity: number | null;
  itemReadableId: string | null;
  itemDescription: string | null;
  materials: unknown;
};

type BatchRow = {
  id: string;
  readableId: string;
  processId: string;
  workCenterId: string | null;
  status: string;
};

type BatchMember = {
  id: string;
  description: string | null;
  operationQuantity: number | null;
  jobOperationBatchId: string | null;
  jobId: string;
  job: { jobId: string } | null;
};

type WorkCenter = { id: string; name: string };

type Props = {
  candidates: BatchCandidate[];
  batches: BatchRow[];
  members: BatchMember[];
  workCenters: WorkCenter[];
  locationId: string;
};

function materialsOf(candidate: BatchCandidate): BatchOperationMaterial[] {
  return Array.isArray(candidate.materials)
    ? (candidate.materials as BatchOperationMaterial[])
    : [];
}

export function BatchPlanningBoard({
  candidates,
  batches,
  members,
  workCenters,
  locationId
}: Props) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const [filters, setFilters] = useState<Record<Facet, string>>({
    substance: "",
    grade: "",
    dimension: "",
    finish: "",
    form: ""
  });

  const facetOptions = useMemo(() => {
    const opts: Record<Facet, Set<string>> = {
      substance: new Set(),
      grade: new Set(),
      dimension: new Set(),
      finish: new Set(),
      form: new Set()
    };
    for (const c of candidates) {
      for (const m of materialsOf(c)) {
        for (const f of FACETS) {
          const v = m[f];
          if (v) opts[f].add(v);
        }
      }
    }
    return opts;
  }, [candidates]);

  const activeFacets = FACETS.filter((f) => filters[f]);

  const visibleCandidates = useMemo(() => {
    if (activeFacets.length === 0) return candidates;
    return candidates.filter((c) => {
      const mats = materialsOf(c);
      // A candidate matches when one of its material lines resolves to every
      // selected facet value (all facets satisfied by the same BOM line).
      return mats.some((m) =>
        activeFacets.every((f) => (m[f] ?? "") === filters[f])
      );
    });
  }, [candidates, filters, activeFacets]);

  const groups = useMemo(() => {
    const byKey = new Map<string, BatchCandidate[]>();
    for (const c of visibleCandidates) {
      const mats = materialsOf(c);
      const key =
        mats.length === 0
          ? t`No material properties`
          : [mats[0].substance, mats[0].grade, mats[0].dimension]
              .filter(Boolean)
              .join(" · ") || t`No material properties`;
      const arr = byKey.get(key) ?? [];
      arr.push(c);
      byKey.set(key, arr);
    }
    return Array.from(byKey.entries());
  }, [visibleCandidates, t]);

  const membersByBatch = useMemo(() => {
    const map = new Map<string, BatchMember[]>();
    for (const m of members) {
      if (!m.jobOperationBatchId) continue;
      const arr = map.get(m.jobOperationBatchId) ?? [];
      arr.push(m);
      map.set(m.jobOperationBatchId, arr);
    }
    return map;
  }, [members]);

  function onDragEnd(event: DragEndEvent) {
    const active = event.active.data.current as
      | { kind: "candidate"; op: BatchCandidate }
      | { kind: "member"; batchId: string; op: BatchMember }
      | undefined;
    const over = event.over?.data.current as
      | { zone: "new" | "batch" | "pool"; batchId?: string }
      | undefined;
    if (!active || !over) return;

    if (over.zone === "new" && active.kind === "candidate") {
      fetcher.submit(
        {
          intent: "create",
          processId: active.op.processId ?? "",
          locationId,
          jobOperationIds: active.op.id
        },
        { method: "post" }
      );
    } else if (
      over.zone === "batch" &&
      over.batchId &&
      active.kind === "candidate"
    ) {
      fetcher.submit(
        {
          intent: "add",
          jobOperationBatchId: over.batchId,
          jobOperationIds: active.op.id
        },
        { method: "post" }
      );
    } else if (over.zone === "pool" && active.kind === "member") {
      fetcher.submit(
        {
          intent: "remove",
          jobOperationBatchId: active.batchId,
          jobOperationIds: active.op.id
        },
        { method: "post" }
      );
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-full w-full overflow-hidden">
        {/* Candidate pool */}
        <PoolZone>
          <div className="flex flex-col gap-3 p-4">
            <HStack className="justify-between">
              <Heading size="h4">{t`Candidate Operations`}</Heading>
              <Badge variant="secondary">{visibleCandidates.length}</Badge>
            </HStack>
            <HStack className="flex-wrap gap-2">
              {FACETS.map((f) => (
                <select
                  key={f}
                  aria-label={f}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm capitalize"
                  value={filters[f]}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, [f]: e.target.value }))
                  }
                >
                  <option value="">{f}</option>
                  {Array.from(facetOptions[f])
                    .sort()
                    .map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                </select>
              ))}
            </HStack>
            <VStack spacing={4}>
              {groups.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t`No batchable operations`}
                </p>
              )}
              {groups.map(([key, ops]) => (
                <div key={key} className="w-full">
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    {key}
                  </p>
                  <div className="flex flex-col gap-2">
                    {ops.map((op) => (
                      <DraggableCard
                        key={op.id}
                        id={op.id}
                        data={{ kind: "candidate", op }}
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {op.jobReadableId ?? op.jobId}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {op.itemReadableId ??
                              op.description ??
                              op.processName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t`Qty`} {op.operationQuantity ?? 0}
                          </span>
                        </div>
                      </DraggableCard>
                    ))}
                  </div>
                </div>
              ))}
            </VStack>
          </div>
        </PoolZone>

        {/* Batch lanes */}
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          <NewBatchZone label={t`New batch`} />
          <div className="flex flex-wrap gap-4">
            {batches.map((batch) => (
              <BatchLane
                key={batch.id}
                batch={batch}
                members={membersByBatch.get(batch.id) ?? []}
                workCenters={workCenters}
                fetcher={fetcher}
                t={t}
              />
            ))}
            {batches.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t`No active batches. Drag an operation onto "New batch" to start one.`}
              </p>
            )}
          </div>
        </div>
      </div>
    </DndContext>
  );
}

function DraggableCard({
  id,
  data,
  children
}: {
  id: string;
  data: Record<string, unknown>;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id, data });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab rounded-md border border-border bg-card p-2 shadow-sm",
        isDragging && "opacity-50"
      )}
    >
      {children}
    </div>
  );
}

function PoolZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "pool",
    data: { zone: "pool" }
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-full w-80 shrink-0 overflow-auto border-r border-border",
        isOver && "bg-muted/50"
      )}
    >
      {children}
    </div>
  );
}

function NewBatchZone({ label }: { label: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "new-batch",
    data: { zone: "new" }
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-border py-6 text-sm text-muted-foreground",
        isOver && "border-primary bg-primary/5 text-foreground"
      )}
    >
      <LuLayers /> {label}
    </div>
  );
}

function BatchLane({
  batch,
  members,
  workCenters,
  fetcher,
  t
}: {
  batch: BatchRow;
  members: BatchMember[];
  workCenters: WorkCenter[];
  fetcher: ReturnType<typeof useFetcher>;
  t: ReturnType<typeof useLingui>["t"];
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `batch:${batch.id}`,
    data: { zone: "batch", batchId: batch.id }
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 flex-col gap-2 rounded-md border border-border bg-card p-3",
        isOver && "ring-2 ring-primary"
      )}
    >
      <HStack className="justify-between">
        <HStack className="gap-2">
          <Badge>{batch.readableId}</Badge>
          <span className="text-xs text-muted-foreground">
            {members.length} {t`ops`}
          </span>
        </HStack>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t`Dissolve batch`}
          onClick={() =>
            fetcher.submit(
              { intent: "dissolve", jobOperationBatchId: batch.id },
              { method: "post" }
            )
          }
        >
          <LuTrash2 />
        </Button>
      </HStack>
      <select
        aria-label={t`Work center`}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        value={batch.workCenterId ?? ""}
        onChange={(e) =>
          fetcher.submit(
            {
              intent: "updateWorkCenter",
              jobOperationBatchId: batch.id,
              workCenterId: e.target.value
            },
            { method: "post" }
          )
        }
      >
        <option value="">{t`Unassigned work center`}</option>
        {workCenters.map((wc) => (
          <option key={wc.id} value={wc.id}>
            {wc.name}
          </option>
        ))}
      </select>
      <div className="flex flex-col gap-2">
        {members.map((m) => (
          <DraggableCard
            key={m.id}
            id={m.id}
            data={{ kind: "member", batchId: batch.id, op: m }}
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {m.job?.jobId ?? m.jobId}
              </span>
              <span className="text-xs text-muted-foreground">
                {m.description} · {t`Qty`} {m.operationQuantity ?? 0}
              </span>
            </div>
          </DraggableCard>
        ))}
      </div>
    </div>
  );
}
