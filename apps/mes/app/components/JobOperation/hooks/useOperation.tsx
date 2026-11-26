// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useChangedRows } from "@carbon/query";
import { toast, useDisclosure, useInterval, useViewport } from "@carbon/react";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  parseDate,
  today,
  toZoned
} from "@internationalized/date";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime, useUser } from "~/hooks";
import type {
  JobMaterial,
  JobOperationParameter,
  JobOperationStep,
  OperationWithDetails,
  ProductionEvent
} from "~/services/types";
import { path } from "~/utils/path";

export function useOperation({
  operation,
  events,
  pauseInterval,
  procedure,
  batchId
}: {
  operation: OperationWithDetails;
  events: ProductionEvent[];
  pauseInterval: boolean;
  procedure: Promise<{
    attributes: JobOperationStep[];
    parameters: JobOperationParameter[];
  }>;
  // In batch mode, subscribe to every productionEvent for the batch (all
  // members' timers) rather than just this operation's, so the shared running
  // timer stays live regardless of which member started it.
  batchId?: string;
}) {
  // oxlint-disable-next-line no-unused-vars -- suppressed due to migration
  const { carbon, accessToken } = useCarbon();
  const user = useUser();

  const actionsSheet = useDisclosure();
  const scrapModal = useDisclosure();
  const reworkModal = useDisclosure();
  const completeModal = useDisclosure();
  const finishModal = useDisclosure();
  const issueModal = useDisclosure();

  // we do this to avoid re-rendering when the modal is open
  const isAnyModalOpen =
    pauseInterval ||
    actionsSheet.isOpen ||
    scrapModal.isOpen ||
    reworkModal.isOpen ||
    completeModal.isOpen ||
    finishModal.isOpen ||
    issueModal.isOpen;

  const [selectedMaterial, setSelectedMaterial] = useState<JobMaterial | null>(
    null
  );

  const [activeTab, setActiveTab] = useState("details");
  const { isPhone } = useViewport();
  // Phones open on the timer that runs, so Pause shows for it. A Setup or
  // Labor timer counts only when it is this user's; Machine counts for anyone
  // (the same rule as `activeEvents` below). Else: Setup, Machine, Labor.
  const [eventType, setEventType] = useState<string>(() => {
    const isRunning = (type: string) =>
      events.some(
        (e) =>
          e.type === type &&
          e.endTime === null &&
          (type === "Machine" || e.employeeId === user.id)
      );
    const running =
      isPhone && (["Setup", "Machine", "Labor"] as const).find(isRunning);
    if (running) {
      return running;
    }
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

  useRealtime("job", `id=eq.${operation.jobId}`);

  useChangedRows<ProductionEvent>({
    companyId: user.company.id,
    table: "productionEvent",
    filter: batchId
      ? `jobOperationBatchId=eq.${batchId}`
      : `jobOperationId=eq.${operation.id}`,
    onChange: ({ op, ids, rows }) => {
      if (op === "DELETE") {
        setEventState((prevEvents) =>
          prevEvents.filter((event) => !ids.includes(event.id))
        );
        return;
      }
      const mine = rows.filter((row) =>
        batchId
          ? row.jobOperationBatchId === batchId
          : row.jobOperationId === operation.id
      );
      setEventState((prevEvents) => {
        let next = prevEvents;
        for (const row of mine) {
          next = next.some((event) => event.id === row.id)
            ? next.map((event) =>
                event.id === row.id ? { ...event, ...row } : event
              )
            : [...next, row];
        }
        return next;
      });
    }
  });

  useChangedRows<{
    id: string;
    status?: OperationWithDetails["operationStatus"];
  }>({
    companyId: user.company.id,
    table: "jobOperation",
    filter: `id=eq.${operation.id}`,
    onChange: ({ op, ids, rows }) => {
      if (op === "DELETE") {
        if (ids.includes(operation.id)) {
          toast.error("This operation has been deleted");
          window.location.href = path.to.operations;
        }
        return;
      }
      const updated = rows.find((row) => row.id === operation.id);
      if (!updated) return;
      setOperationState((prev) => ({
        ...prev,
        ...updated,
        operationStatus: updated.status ?? prev.operationStatus
      }));
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

  return {
    active,
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
    // The JOB's deadline. The operation's own `operationDueDate` is the
    // scheduler's need-by target for this step, shown separately.
    isOverdue: operation.jobDueDate
      ? parseDate(operation.jobDueDate.slice(0, 10)).compare(
          today(getLocalTimeZone())
        ) < 0
      : false,
    selectedMaterial,
    setSelectedMaterial,
    setActiveTab,
    setEventType
  };
}
