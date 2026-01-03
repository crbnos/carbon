import { DateTimePicker, Hidden, Select, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useCallback, useEffect, useState } from "react";
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod/v3";
import {
  Assignee,
  EmployeeAvatar,
  useOptimisticAssignment
} from "~/components";
import { Location, WorkCenter } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import {
  maintenanceDispatchEventValidator,
  maintenanceDispatchPriority,
  maintenanceSeverity,
  maintenanceSource,
  oeeImpact
} from "../../resources.models";
import type {
  MaintenanceDispatchDetail,
  MaintenanceDispatchEvent
} from "../../types";
import MaintenanceOeeImpact from "./MaintenanceOeeImpact";
import MaintenancePriority from "./MaintenancePriority";
import MaintenanceSeverity from "./MaintenanceSeverity";
import MaintenanceSource from "./MaintenanceSource";
import MaintenanceStatus from "./MaintenanceStatus";

const MaintenanceDispatchProperties = () => {
  const { dispatchId } = useParams();
  if (!dispatchId) throw new Error("dispatchId not found");

  const permissions = usePermissions();
  const eventModal = useDisclosure();
  const [selectedEvent, setSelectedEvent] =
    useState<MaintenanceDispatchEvent | null>(null);

  const routeData = useRouteData<{
    dispatch: MaintenanceDispatchDetail;
    events: MaintenanceDispatchEvent[];
    failureModes: { id: string; name: string }[];
  }>(path.to.maintenanceDispatch(dispatchId));

  const optimisticAssignment = useOptimisticAssignment({
    id: dispatchId,
    table: "maintenanceDispatch"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.dispatch?.assignee;

  const fetcher = useFetcher<{ error?: { message: string } }>();
  const eventFetcher = useFetcher<{ error?: { message: string } }>();

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (
      eventFetcher.state === "idle" &&
      eventFetcher.data &&
      !eventFetcher.data.error
    ) {
      eventModal.onClose();
      setSelectedEvent(null);
    }
    if (eventFetcher.data?.error) {
      toast.error(eventFetcher.data.error.message);
    }
  }, [eventFetcher.state, eventFetcher.data, eventModal]);

  const onUpdate = useCallback(
    (field: string, value: string | null) => {
      const formData = new FormData();
      formData.append("ids", dispatchId);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.maintenanceDispatchUpdate
      });
    },
    [dispatchId, fetcher]
  );

  const isCompleted = routeData?.dispatch?.status === "Completed";

  const [currentOeeImpact, setCurrentOeeImpact] = useState<string>(
    routeData?.dispatch?.oeeImpact ?? "No Impact"
  );

  const showFailureModes =
    currentOeeImpact === "Down" || currentOeeImpact === "Impact";

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Properties</h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin +
                        path.to.maintenanceDispatch(dispatchId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to dispatch</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy ID"
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(routeData?.dispatch?.id ?? "")}
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy dispatch ID</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      routeData?.dispatch?.maintenanceDispatchId ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy dispatch number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm tracking-tight">
          {routeData?.dispatch?.maintenanceDispatchId}
        </span>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Status</h3>
        <MaintenanceStatus status={routeData?.dispatch?.status} />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee
          id={dispatchId}
          table="maintenanceDispatch"
          size="sm"
          value={assignee ?? ""}
          isReadOnly={!permissions.can("update", "resources")}
        />
      </VStack>

      <ValidatedForm
        defaultValues={{
          locationId: routeData?.dispatch?.locationId ?? ""
        }}
        validator={z.object({
          locationId: z.string().optional()
        })}
        className="w-full"
      >
        <Location
          isReadOnly={!permissions.can("update", "resources")}
          label="Location"
          name="locationId"
          inline
          isClearable
          onChange={(value) => {
            onUpdate("locationId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          workCenterId: routeData?.dispatch?.workCenterId ?? ""
        }}
        validator={z.object({
          workCenterId: z.string().optional()
        })}
        className="w-full"
      >
        <WorkCenter
          isReadOnly={!permissions.can("update", "resources")}
          label="Work Center"
          name="workCenterId"
          inline
          isClearable
          onChange={(value) => {
            onUpdate("workCenterId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          priority: routeData?.dispatch?.priority ?? ""
        }}
        validator={z.object({
          priority: z.string().optional()
        })}
        className="w-full"
      >
        <Select
          options={maintenanceDispatchPriority.map((priority) => ({
            value: priority,
            label: (
              <div className="flex gap-2 items-center">
                <MaintenancePriority priority={priority} />
              </div>
            )
          }))}
          isReadOnly={!permissions.can("update", "resources")}
          label="Priority"
          name="priority"
          inline={(value) => {
            return (
              <MaintenancePriority
                priority={value as (typeof maintenanceDispatchPriority)[number]}
              />
            );
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("priority", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          severity: routeData?.dispatch?.severity ?? ""
        }}
        validator={z.object({
          severity: z.string().optional()
        })}
        className="w-full"
      >
        <Select
          options={maintenanceSeverity.map((severity) => ({
            value: severity,
            label: severity
          }))}
          isReadOnly={!permissions.can("update", "resources")}
          label="Severity"
          name="severity"
          inline={(value) => {
            return (
              <MaintenanceSeverity
                severity={value as (typeof maintenanceSeverity)[number]}
              />
            );
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("severity", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          source: routeData?.dispatch?.source ?? ""
        }}
        validator={z.object({
          source: z.string().optional()
        })}
        className="w-full"
      >
        <Select
          options={maintenanceSource.map((source) => ({
            value: source,
            label: <MaintenanceSource source={source} />
          }))}
          isReadOnly={!permissions.can("update", "resources")}
          label="Source"
          name="source"
          inline={(value) => {
            return (
              <MaintenanceSource
                source={value as (typeof maintenanceSource)[number]}
              />
            );
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("source", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          oeeImpact: routeData?.dispatch?.oeeImpact ?? "No Impact"
        }}
        validator={z.object({
          oeeImpact: z.string().optional()
        })}
        className="w-full"
      >
        <Select
          options={oeeImpact.map((impact) => ({
            value: impact,
            label: <MaintenanceOeeImpact oeeImpact={impact} />
          }))}
          isReadOnly={!permissions.can("update", "resources")}
          label="OEE Impact"
          name="oeeImpact"
          inline={(value) => {
            return (
              <MaintenanceOeeImpact
                oeeImpact={value as (typeof oeeImpact)[number]}
              />
            );
          }}
          onChange={(value) => {
            if (value) {
              setCurrentOeeImpact(value.value);
              onUpdate("oeeImpact", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          plannedStartTime: routeData?.dispatch?.plannedStartTime ?? ""
        }}
        validator={z.object({
          plannedStartTime: z.string().optional()
        })}
        className="w-full"
      >
        <DateTimePicker
          name="plannedStartTime"
          label="Planned Start"
          inline
          isDisabled={!permissions.can("update", "resources") || isCompleted}
          onChange={(date) => {
            onUpdate("plannedStartTime", date?.toString() ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          plannedEndTime: routeData?.dispatch?.plannedEndTime ?? ""
        }}
        validator={z.object({
          plannedEndTime: z.string().optional()
        })}
        className="w-full"
      >
        <DateTimePicker
          name="plannedEndTime"
          label="Planned End"
          inline
          isDisabled={!permissions.can("update", "resources") || isCompleted}
          onChange={(date) => {
            onUpdate("plannedEndTime", date?.toString() ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          actualStartTime: routeData?.dispatch?.actualStartTime ?? ""
        }}
        validator={z.object({
          actualStartTime: z.string().optional()
        })}
        className="w-full"
      >
        <DateTimePicker
          name="actualStartTime"
          label="Actual Start"
          inline
          isDisabled={!permissions.can("update", "resources") || isCompleted}
          onChange={(date) => {
            onUpdate("actualStartTime", date?.toString() ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          actualEndTime: routeData?.dispatch?.actualEndTime ?? ""
        }}
        validator={z.object({
          actualEndTime: z.string().optional()
        })}
        className="w-full"
      >
        <DateTimePicker
          name="actualEndTime"
          label="Actual End"
          inline
          isDisabled={!permissions.can("update", "resources") || isCompleted}
          onChange={(date) => {
            onUpdate("actualEndTime", date?.toString() ?? null);
          }}
        />
      </ValidatedForm>

      {showFailureModes && (
        <>
          <ValidatedForm
            defaultValues={{
              suspectedFailureModeId:
                routeData?.dispatch?.suspectedFailureModeId ?? ""
            }}
            validator={z.object({
              suspectedFailureModeId: z.string().optional()
            })}
            className="w-full"
          >
            <Select
              options={(routeData?.failureModes ?? []).map((mode) => ({
                value: mode.id,
                label: mode.name
              }))}
              isReadOnly={!permissions.can("update", "resources")}
              label="Suspected Failure Mode"
              name="suspectedFailureModeId"
              inline={(value) => {
                return (
                  <span>
                    {routeData?.failureModes.find((mode) => mode.id === value)
                      ?.name ?? ""}
                  </span>
                );
              }}
              isClearable
              onChange={(value) => {
                onUpdate("suspectedFailureModeId", value?.value ?? null);
              }}
            />
          </ValidatedForm>

          <ValidatedForm
            defaultValues={{
              actualFailureModeId:
                routeData?.dispatch?.actualFailureModeId ?? ""
            }}
            validator={z.object({
              actualFailureModeId: z.string().optional()
            })}
            className="w-full"
          >
            <Select
              options={(routeData?.failureModes ?? []).map((mode) => ({
                value: mode.id,
                label: mode.name
              }))}
              isReadOnly={!permissions.can("update", "resources")}
              label="Actual Failure Mode"
              name="actualFailureModeId"
              inline={(value) => {
                return (
                  <span>
                    {routeData?.failureModes.find((mode) => mode.id === value)
                      ?.name ?? ""}
                  </span>
                );
              }}
              isClearable
              onChange={(value) => {
                onUpdate("actualFailureModeId", value?.value ?? null);
              }}
            />
          </ValidatedForm>
        </>
      )}

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Created By</h3>
        <EmployeeAvatar
          employeeId={routeData?.dispatch?.createdBy!}
          size="xxs"
        />
      </VStack>

      {/* Timecard Edit Modal */}
      {eventModal.isOpen && selectedEvent && (
        <Modal
          open={eventModal.isOpen}
          onOpenChange={(open) => {
            if (!open) {
              eventModal.onClose();
              setSelectedEvent(null);
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              action={path.to.maintenanceDispatchEvents(dispatchId)}
              validator={maintenanceDispatchEventValidator}
              fetcher={eventFetcher}
              defaultValues={{
                id: selectedEvent.id,
                maintenanceDispatchId: dispatchId,
                employeeId: selectedEvent.employee.id,
                workCenterId:
                  selectedEvent.workCenter.id ??
                  routeData?.dispatch?.workCenterId ??
                  "",
                startTime: selectedEvent.startTime,
                endTime: selectedEvent.endTime ?? ""
              }}
            >
              <ModalHeader>
                <ModalTitle>Edit Timecard</ModalTitle>
              </ModalHeader>
              <ModalBody>
                <VStack spacing={4}>
                  <HStack spacing={2}>
                    <EmployeeAvatar
                      employeeId={selectedEvent.employee.id}
                      size="sm"
                    />
                    <span className="text-sm font-medium">
                      {selectedEvent.employee?.fullName ?? "Unknown"}
                    </span>
                  </HStack>
                  <Hidden name="id" value={selectedEvent.id} />
                  <Hidden name="maintenanceDispatchId" value={dispatchId} />
                  <Hidden name="employeeId" value={selectedEvent.employee.id} />
                  <Hidden
                    name="workCenterId"
                    value={
                      selectedEvent.workCenter.id ??
                      routeData?.dispatch?.workCenterId ??
                      ""
                    }
                  />
                  <DateTimePicker
                    name="startTime"
                    label="Start Time"
                    isDisabled={!permissions.can("update", "resources")}
                  />
                  <DateTimePicker
                    name="endTime"
                    label="End Time"
                    isDisabled={!permissions.can("update", "resources")}
                  />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    eventModal.onClose();
                    setSelectedEvent(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isLoading={eventFetcher.state !== "idle"}
                  isDisabled={!permissions.can("update", "resources")}
                >
                  Save
                </Button>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </VStack>
  );
};

export default MaintenanceDispatchProperties;
