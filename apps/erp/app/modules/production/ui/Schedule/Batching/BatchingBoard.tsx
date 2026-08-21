import { Badge, Combobox, HStack, toast, VStack } from "@carbon/react";
import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef } from "react";
import { LuLayers, LuTrash, LuX } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { SearchFilter } from "~/components";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { BatchCandidate, BatchLaneData } from "./types";

type Props = {
  locationId: string;
  processId: string | null;
  processes: { id: string; name: string }[];
  workCenters: Array<{ id: string | null; name: string | null }>;
  candidates: BatchCandidate[];
  batches: BatchLaneData[];
  facetOptions: Record<string, { id: string; name: string }[]>;
};

const FACETS: { key: string; header: string }[] = [
  { key: "substanceId", header: "Substance" },
  { key: "gradeId", header: "Grade" },
  { key: "dimensionId", header: "Dimension" },
  { key: "formId", header: "Form" },
  { key: "finishId", header: "Finish" }
];

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

export function BatchingBoard({
  locationId,
  processId,
  processes,
  workCenters,
  candidates,
  batches,
  facetOptions
}: Props) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const fetcher = useFetcher<{ success?: boolean; message?: string }>();

  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const d = fetcher.data;
    if (
      d?.success === false &&
      d.message &&
      d.message !== lastErrorRef.current
    ) {
      lastErrorRef.current = d.message;
      toast.error(d.message);
    }
  }, [fetcher.data]);

  const processOptions = useMemo(
    () => processes.map((p) => ({ label: p.name, value: p.id })),
    [processes]
  );

  const workCenterOptions = useMemo(
    () =>
      workCenters
        .filter((wc) => wc.id)
        .map((wc) => ({ label: wc.name ?? "", value: wc.id as string })),
    [workCenters]
  );

  const filters = useMemo<ColumnFilter[]>(
    () =>
      FACETS.filter((f) => (facetOptions[f.key]?.length ?? 0) > 0).map((f) => ({
        accessorKey: f.key,
        header: f.header,
        filter: {
          type: "static",
          isArray: true,
          options: (facetOptions[f.key] ?? []).map((o) => ({
            label: o.name,
            value: o.id
          }))
        }
      })),
    [facetOptions]
  );

  const submit = (formData: FormData) => {
    fetcher.submit(formData, {
      method: "post",
      action: path.to.scheduleBatchingUpdate
    });
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 }
    })
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const opId = active.data.current?.opId as string | undefined;
    const fromBatchId = active.data.current?.fromBatchId as string | undefined;
    const target = String(over.id);
    if (!opId || target === active.data.current?.container) return;

    const fd = new FormData();
    if (target === "new-batch" && !fromBatchId) {
      fd.set("intent", "create");
      fd.set("locationId", locationId);
      fd.append("jobOperationIds", opId);
      submit(fd);
    } else if (target === "candidates" && fromBatchId) {
      fd.set("intent", "remove");
      fd.set("batchId", fromBatchId);
      fd.append("jobOperationIds", opId);
      submit(fd);
    } else if (target.startsWith("batch:") && !fromBatchId) {
      fd.set("intent", "add");
      fd.set("batchId", target.slice("batch:".length));
      fd.append("jobOperationIds", opId);
      submit(fd);
    }
  }

  const onProcessChange = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("process", value);
    else next.delete("process");
    navigate(`${path.to.scheduleBatching}?${next.toString()}`);
  };

  return (
    <div className="flex flex-col h-full w-full">
      <HStack className="w-full justify-between border-b p-2">
        <HStack spacing={2}>
          <div className="w-64">
            <Combobox
              value={processId ?? ""}
              options={processOptions}
              onChange={onProcessChange}
              placeholder={t`Select a batchable process`}
            />
          </div>
          {processId && (
            <>
              <SearchFilter param="search" size="sm" placeholder={t`Search`} />
              <Filter filters={filters} />
            </>
          )}
        </HStack>
      </HStack>

      {!processId ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <VStack spacing={2} className="items-center">
            <LuLayers className="size-8" />
            <span>{t`Pick a batchable process to plan batches`}</span>
          </VStack>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex flex-1 min-h-0">
            {/* Candidates pane */}
            <CandidatesPane count={candidates.length}>
              <ActiveFilters filters={filters} />
              <div className="flex flex-col gap-2 overflow-y-auto p-2">
                {candidates.length === 0 ? (
                  <p className="p-2 text-sm text-muted-foreground">
                    {t`No unbatched operations match`}
                  </p>
                ) : (
                  candidates.map((c) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      container="candidates"
                    />
                  ))
                )}
              </div>
            </CandidatesPane>

            {/* Batch lanes pane */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto border-l p-3">
              {batches.map((b) => (
                <BatchLane
                  key={b.id}
                  batch={b}
                  workCenterOptions={workCenterOptions}
                  onWorkCenterChange={(workCenterId) => {
                    const fd = new FormData();
                    fd.set("intent", "update");
                    fd.set("batchId", b.id);
                    if (workCenterId) fd.set("workCenterId", workCenterId);
                    submit(fd);
                  }}
                  onDissolve={() => {
                    const fd = new FormData();
                    fd.set("intent", "dissolve");
                    fd.set("batchId", b.id);
                    submit(fd);
                  }}
                />
              ))}
              <NewBatchDropZone />
            </div>
          </div>
        </DndContext>
      )}
    </div>
  );
}

function CandidatesPane({
  count,
  children
}: {
  count: number;
  children: React.ReactNode;
}) {
  const { t } = useLingui();
  const { setNodeRef, isOver } = useDroppable({ id: "candidates" });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-96 flex-col border-r ${isOver ? "bg-muted/40" : ""}`}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">
          {t`Operations`}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function CandidateCard({
  candidate,
  container,
  fromBatchId,
  draggable = true
}: {
  candidate: BatchCandidate;
  container: string;
  fromBatchId?: string;
  // A Completing batch's members are frozen — rendered without drag handles.
  draggable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${container}:${candidate.id}`,
    data: { opId: candidate.id, fromBatchId, container },
    disabled: !draggable
  });
  const chips = materialChips(candidate);
  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      className={`rounded-lg border bg-card p-3 shadow-button-base ${
        draggable ? "cursor-grab" : "cursor-default"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <HStack className="w-full justify-between">
        <span className="truncate text-sm font-medium">
          {candidate.jobReadableId}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {candidate.operationQuantity ?? 0}
        </span>
      </HStack>
      <p className="truncate text-xs text-muted-foreground">
        {candidate.itemReadableId} · {candidate.itemDescription}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {chips.length ? (
          chips.map((chip) => (
            <Badge key={chip} variant="secondary" className="text-[10px]">
              {chip}
            </Badge>
          ))
        ) : (
          <Badge variant="outline" className="text-[10px]">
            No material properties
          </Badge>
        )}
      </div>
    </div>
  );
}

function BatchLane({
  batch,
  workCenterOptions,
  onWorkCenterChange,
  onDissolve
}: {
  batch: BatchLaneData;
  workCenterOptions: { label: string; value: string }[];
  onWorkCenterChange: (workCenterId: string) => void;
  onDissolve: () => void;
}) {
  const { t } = useLingui();
  // A Completing batch is mid-completion (a prior attempt left it waiting for a
  // retry in MES). Its lane is read-only: no drop target, no work-center change,
  // no dissolve, and its members can't be dragged out.
  const isCompleting = batch.status === "Completing";
  const { setNodeRef, isOver } = useDroppable({
    id: `batch:${batch.id}`,
    disabled: isCompleting
  });
  const totalQty = batch.members.reduce(
    (sum, m) => sum + (m.operationQuantity ?? 0),
    0
  );
  return (
    <div
      ref={isCompleting ? undefined : setNodeRef}
      className={`rounded-xl border p-2 ${
        isOver && !isCompleting ? "border-primary bg-muted/40" : ""
      }`}
    >
      <HStack className="w-full justify-between px-1 pb-2">
        <HStack spacing={2}>
          <Badge>{batch.readableId}</Badge>
          {isCompleting && <Badge variant="yellow">{t`Completing`}</Badge>}
          <span className="text-xs tabular-nums text-muted-foreground">
            {batch.members.length} · {totalQty}
          </span>
        </HStack>
        {isCompleting ? (
          <a
            href={path.to.external.mesBatch(batch.id)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t`Completion in progress — retry in Shop Floor`}
          </a>
        ) : (
          <HStack spacing={2}>
            <div className="w-48">
              <Combobox
                value={batch.workCenterId ?? ""}
                options={workCenterOptions}
                onChange={onWorkCenterChange}
                placeholder={t`Work center`}
              />
            </div>
            <button
              type="button"
              aria-label={t`Dissolve batch`}
              className="text-muted-foreground hover:text-destructive"
              onClick={onDissolve}
            >
              <LuTrash className="size-4" />
            </button>
          </HStack>
        )}
      </HStack>
      <div className="flex flex-col gap-2">
        {batch.members.map((m) => (
          <CandidateCard
            key={m.id}
            candidate={m}
            container={`batch:${batch.id}`}
            fromBatchId={batch.id}
            draggable={!isCompleting}
          />
        ))}
      </div>
    </div>
  );
}

function NewBatchDropZone() {
  const { t } = useLingui();
  const { setNodeRef, isOver } = useDroppable({ id: "new-batch" });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-24 items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground ${
        isOver ? "border-primary bg-muted/40" : ""
      }`}
    >
      <HStack spacing={2}>
        <LuX className="size-4 rotate-45" />
        {t`Drag here to start a new batch`}
      </HStack>
    </div>
  );
}
