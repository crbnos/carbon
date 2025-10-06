import { toast, useDisclosure, useInterval, useMount } from "@carbon/react";
import { useParams, useRevalidator } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUrlParams, useUser } from "~/hooks";
import type {
  JobMaterial,
  JobOperationParameter,
  JobOperationStep,
  OperationWithDetails,
  ProductionEvent,
  TrackedEntity,
} from "~/services/types";
import { path } from "~/utils/path";

import { useCarbon } from "@carbon/auth";
import type { TrackedEntityAttributes } from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned,
} from "@internationalized/date";
import type { RealtimeChannel } from "@supabase/supabase-js";

export function useOperation({
  operation,
  events,
  trackedEntities,
  pauseInterval,
  procedure,
}: {
  operation: OperationWithDetails;
  events: ProductionEvent[];
  trackedEntities: TrackedEntity[];
  pauseInterval: boolean;
  procedure: Promise<{
    attributes: JobOperationStep[];
    parameters: JobOperationParameter[];
  }>;
}) {
  const [params] = useUrlParams();
  const trackedEntityParam = params.get("trackedEntityId");
  const { carbon, accessToken } = useCarbon();
  const user = useUser();
  const revalidator = useRevalidator();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const scrapModal = useDisclosure();
  const reworkModal = useDisclosure();
  const completeModal = useDisclosure();
  const finishModal = useDisclosure();
  const issueModal = useDisclosure();
  const serialModal = useDisclosure();

  // we do this to avoid re-rendering when the modal is open
  const isAnyModalOpen =
    pauseInterval ||
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

  useMount(() => {
    if (!channelRef.current && carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
      channelRef.current = carbon
        .channel(`job-operations:${operation.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "job",
            filter: `id=eq.${operation.jobId}`,
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
            filter: `jobOperationId=eq.${operation.id}`,
          },
          (payload) => {
            switch (payload.eventType) {
              case "INSERT":
                const { new: inserted } = payload;
                setEventState((prevEvents) => [
                  ...prevEvents,
                  inserted as ProductionEvent,
                ]);
                break;
              case "UPDATE":
                const { new: updated } = payload;

                setEventState((prevEvents) =>
                  prevEvents.map((event) =>
                    event.id === updated.id
                      ? ({
                          ...event,
                          ...updated,
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
            filter: `id=eq.${operation.id}`,
          },
          (payload) => {
            if (payload.eventType === "UPDATE") {
              const updated = payload.new;
              setOperationState((prev) => ({
                ...prev,
                ...updated,
                operationStatus: updated.status ?? prev.operationStatus,
              }));
            } else if (payload.eventType === "DELETE") {
              toast.error("This operation has been deleted");
              window.location.href = path.to.operations;
            }
          }
        )
        .subscribe();
    }

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        carbon?.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  });

  useEffect(() => {
    if (carbon && accessToken && channelRef.current)
      carbon.realtime.setAuth(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

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
        machine: 0,
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
      ),
    };
  }, [eventState, events, user.id]);

  const active = useMemo(() => {
    return {
      setup: !!activeEvents.setupProductionEvent,
      labor: !!activeEvents.laborProductionEvent,
      machine: !!activeEvents.machineProductionEvent,
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
  // show the serial selector with the remaining serial numbers for the operation
  useEffect(() => {
    if (trackedEntityParam) return;
    const uncompletedEntities = trackedEntities.filter(
      (entity) =>
        !(
          `Operation ${operationId}` in
          ((entity.attributes as TrackedEntityAttributes) ?? {})
        )
    );
    if (uncompletedEntities.length > 0) serialModal.onOpen();
    setAvailableEntities(uncompletedEntities);
    // causes an infinite loop on navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedEntities, trackedEntityParam]);

  return {
    active,
    availableEntities,
    hasActiveEvents:
      progress.setup > 0 || progress.labor > 0 || progress.machine > 0,
    ...activeEvents,
    progress,
    operation: operationState,

    activeTab,
    eventType,
    scrapModal,
    reworkModal,
    completeModal,
    finishModal,
    issueModal,
    serialModal,
    isOverdue: operation.jobDueDate
      ? new Date(operation.jobDueDate) < new Date()
      : false,
    selectedMaterial,
    setSelectedMaterial,
    setActiveTab,
    setEventType,
  };
}
