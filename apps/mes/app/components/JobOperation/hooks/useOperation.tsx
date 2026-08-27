import { useCarbon } from "@carbon/auth";
import {
  toast,
  useDisclosure,
  useInterval,
  useRealtimeChannel
} from "@carbon/react";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned
} from "@internationalized/date";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRevalidator } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import { isSerialEntityIncompleteForOperation } from "~/services/operations.service";
import { shouldAdvanceToNextSerialUnit } from "~/services/serial-advancement";
import type {
  JobMaterial,
  JobOperationParameter,
  JobOperationStep,
  OperationWithDetails,
  ProductionEvent,
  TrackedEntity
} from "~/services/types";
import { path } from "~/utils/path";

export function useOperation({
  operation,
  events,
  trackedEntities,
  isFirstOperation,
  requiresSerialTracking,
  pauseInterval,
  procedure,
  onAdvanceToUnit
}: {
  operation: OperationWithDetails;
  events: ProductionEvent[];
  trackedEntities: TrackedEntity[];
  // The first operation in the routing has no printed labels yet, so units are
  // auto-selected; later operations require the operator to scan/select.
  isFirstOperation: boolean;
  // The scan/select serial flow only applies to serial-tracked parts. Batch and
  // non-tracked make-methods must never see the serial picker, even though a
  // batch make-method carries a seed trackedEntity row.
  requiresSerialTracking: boolean;
  pauseInterval: boolean;
  procedure: Promise<{
    attributes: JobOperationStep[];
    parameters: JobOperationParameter[];
  }>;
  // Auto-select the next serial unit (used on the first operation, where there
  // are no printed labels to scan yet). Provided by JobOperation.
  onAdvanceToUnit?: (entity: TrackedEntity) => void;
}) {
  const [params] = useUrlParams();
  const trackedEntityParam = params.get("trackedEntityId");
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { carbon, accessToken } = useCarbon();
  const user = useUser();

  const revalidator = useRevalidator();
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const channelRef = useRef<RealtimeChannel | null>(null);

  const actionsSheet = useDisclosure();
  const scrapModal = useDisclosure();
  const reworkModal = useDisclosure();
  const completeModal = useDisclosure();
  const finishModal = useDisclosure();
  const issueModal = useDisclosure();
  const serialModal = useDisclosure();

  // we do this to avoid re-rendering when the modal is open
  const isAnyModalOpen =
    pauseInterval ||
    actionsSheet.isOpen ||
    scrapModal.isOpen ||
    reworkModal.isOpen ||
    completeModal.isOpen ||
    finishModal.isOpen ||
    issueModal.isOpen ||
    serialModal.isOpen;

  const [selectedMaterial, setSelectedMaterial] = useState<JobMaterial | null>(
    null
  );

  const [activeTab, setActiveTab] = useState("details");
  const [eventType, setEventType] = useState(() => {
    if (operation.setupDuration > 0) {
      return "Setup";
    }
    if (operation.machineDuration > 0) {
      return "Machine";
    }
    return "Labor";
  });

  const [operationState, setOperationState] = useState(operation);

  const [eventState, setEventState] = useState<ProductionEvent[]>(events);

  useEffect(() => {
    setEventState(events);
  }, [events]);

  useEffect(() => {
    setOperationState(operation);
  }, [operation]);

  useRealtimeChannel({
    topic: `job-operations:${operation.id}`,
    dependencies: [operation.jobId],
    setup(channel) {
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "job",
            filter: `id=eq.${operation.jobId}`
          },
          (payload) => {
            if (payload.eventType === "UPDATE") {
              revalidator.revalidate();
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "productionEvent",
            filter: `jobOperationId=eq.${operation.id}`
          },
          (payload) => {
            switch (payload.eventType) {
              case "INSERT":
                const { new: inserted } = payload;
                setEventState((prevEvents) => [
                  ...prevEvents,
                  inserted as ProductionEvent
                ]);
                break;
              case "UPDATE":
                const { new: updated } = payload;

                setEventState((prevEvents) =>
                  prevEvents.map((event) =>
                    event.id === updated.id
                      ? ({
                          ...event,
                          ...updated
                        } as ProductionEvent)
                      : event
                  )
                );
                break;
              case "DELETE":
                const { old: deleted } = payload;
                setEventState((prevEvents) =>
                  prevEvents.filter((event) => event.id !== deleted.id)
                );
                break;
              default:
                break;
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperation",
            filter: `id=eq.${operation.id}`
          },
          (payload) => {
            if (payload.eventType === "UPDATE") {
              const updated = payload.new;
              setOperationState((prev) => ({
                ...prev,
                ...updated,
                operationStatus: updated.status ?? prev.operationStatus
              }));
            } else if (payload.eventType === "DELETE") {
              toast.error("This operation has been deleted");
              window.location.href = path.to.operations;
            }
          }
        );
    }
  });

  const getProgress = useCallback(() => {
    const timeNow = now(getLocalTimeZone());
    return eventState.reduce(
      (acc, event) => {
        if (event.endTime && event.type) {
          acc[event.type.toLowerCase() as keyof typeof acc] +=
            (event.duration ?? 0) * 1000;
        } else if (event.startTime && event.type) {
          const startTime = toZoned(
            parseAbsolute(event.startTime, getLocalTimeZone()),
            getLocalTimeZone()
          );

          const difference = timeNow.compare(startTime);

          if (difference > 0) {
            acc[event.type.toLowerCase() as keyof typeof acc] += difference;
          }
        }
        return acc;
      },
      {
        setup: 0,
        labor: 0,
        machine: 0
      }
    );
  }, [eventState]);

  const [progress, setProgress] = useState<{
    setup: number;
    labor: number;
    machine: number;
  }>(getProgress);

  const activeEvents = useMemo(() => {
    return {
      setupProductionEvent: events.find(
        (e) =>
          e.type === "Setup" && e.endTime === null && e.employeeId === user.id
      ),
      laborProductionEvent: events.find(
        (e) =>
          e.type === "Labor" && e.endTime === null && e.employeeId === user.id
      ),
      machineProductionEvent: eventState.find(
        (e) => e.type === "Machine" && e.endTime === null
      )
    };
  }, [eventState, events, user.id]);

  const active = useMemo(() => {
    return {
      setup: !!activeEvents.setupProductionEvent,
      labor: !!activeEvents.laborProductionEvent,
      machine: !!activeEvents.machineProductionEvent
    };
  }, [activeEvents]);

  useInterval(
    () => {
      setProgress(getProgress());
    },
    (active.setup || active.labor || active.machine) && !isAnyModalOpen
      ? 1000
      : null
  );

  const { operationId } = useParams();
  const [availableEntities, setAvailableEntities] = useState<TrackedEntity[]>(
    []
  );
  // Later operations prompt scan/select once on arrival — even if a stale or
  // auto-seeded ?trackedEntityId is already in the URL. This ref makes that a
  // once-per-mount prompt so we don't re-open the picker while the operator is
  // working a scanned unit.
  const arrivalPromptedRef = useRef(false);
  // The unit the operator last held. The re-prompt is edge-triggered off this:
  // the picker reopens when the held unit *becomes* complete, never merely
  // because nothing is selected. `trackedEntities` gets a fresh identity on
  // every revalidation (realtime job updates, any start/stop/record fetcher), so
  // a level-triggered "no unit selected → open" would re-open the picker on each
  // one and the operator could never dismiss it.
  const heldEntityRef = useRef<string | null>(null);
  // Select / advance the serial unit the operator works on. This is the single
  // advancement authority — complete.tsx no longer redirects to a next unit.
  //  - First operation: no labels have been printed yet, so there is nothing to
  //    scan — auto-select the next unit and flow through #1..#N.
  //  - Later operations: every unit already carries a printed label, so the
  //    operator scans/selects. Prompt once on arrival (even if a stale param sits
  //    in the URL) and again after each completion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    // Only serial-tracked parts have per-unit labels to scan/select. Batch and
    // non-tracked make-methods must never surface the serial picker.
    if (!requiresSerialTracking) return;
    const uncompletedEntities = trackedEntities.filter((entity) =>
      isSerialEntityIncompleteForOperation(entity, operationId ?? "")
    );
    setAvailableEntities(uncompletedEntities);
    if (uncompletedEntities.length === 0) return;
    const selectedIsIncomplete =
      !!trackedEntityParam &&
      uncompletedEntities.some((entity) => entity.id === trackedEntityParam);

    if (isFirstOperation) {
      // Auto-advance is edge-triggered off the held unit: advance on arrival
      // with nothing selected, or when the held unit itself completes — never
      // over an explicit selection of an already-complete unit (going back to
      // review/re-print is allowed).
      if (
        shouldAdvanceToNextSerialUnit({
          selectedEntityId: trackedEntityParam,
          selectedIsIncomplete,
          heldEntityId: heldEntityRef.current
        })
      ) {
        heldEntityRef.current = null;
        onAdvanceToUnit?.(uncompletedEntities[0]);
      } else {
        heldEntityRef.current = selectedIsIncomplete
          ? trackedEntityParam
          : null;
      }
      return;
    }

    // Prompt scan/select once on arrival — even when a stale/auto-seeded
    // ?trackedEntityId is present, which would otherwise read as "already working
    // a unit".
    if (!arrivalPromptedRef.current) {
      arrivalPromptedRef.current = true;
      heldEntityRef.current = selectedIsIncomplete ? trackedEntityParam : null;
      serialModal.onOpen();
      return;
    }

    if (selectedIsIncomplete) {
      heldEntityRef.current = trackedEntityParam;
      return;
    }

    // The held unit just completed — prompt for the next one. If the operator is
    // holding nothing (they dismissed the picker), stay quiet; the Scan button in
    // the Serial Numbers section reopens it on demand.
    if (heldEntityRef.current) {
      heldEntityRef.current = null;
      serialModal.onOpen();
    }
    // causes an infinite loop on navigation
  }, [
    trackedEntities,
    trackedEntityParam,
    operationId,
    isFirstOperation,
    requiresSerialTracking
  ]);

  return {
    active,
    availableEntities,
    hasActiveEvents:
      progress.setup > 0 || progress.labor > 0 || progress.machine > 0,
    ...activeEvents,
    progress,
    operation: operationState,

    actionsSheet,
    activeTab,
    eventType,
    scrapModal,
    reworkModal,
    completeModal,
    finishModal,
    issueModal,
    serialModal,
    isOverdue: operation.operationDueDate
      ? new Date(operation.operationDueDate) < new Date()
      : false,
    selectedMaterial,
    setSelectedMaterial,
    setActiveTab,
    setEventType
  };
}
