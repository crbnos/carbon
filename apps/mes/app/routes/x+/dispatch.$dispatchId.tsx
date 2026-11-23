// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { Hidden, ValidatedForm } from "@carbon/form";
import {
  Button,
  ClientOnly,
  generateHTML,
  Heading,
  IconButton,
  isRichTextEmpty,
  type JSONContent,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure,
  VStack
} from "@carbon/react";
import { groupBy } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { FaCheck } from "react-icons/fa6";
import {
  LuCalendarClock,
  LuCheck,
  LuCirclePlus,
  LuFactory,
  LuGauge,
  LuInbox,
  LuTimer,
  LuX
} from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { DateTime } from "~/components";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import {
  IconButtonWithTooltip,
  PauseButton,
  PlayButton
} from "~/components/JobOperation/components/Controls";
import { MaintenanceAddPartModal } from "~/components/MaintenanceDispatch";
import MaintenanceOeeImpact from "~/components/MaintenanceOeeImpact";
import MaintenanceSeverity from "~/components/MaintenanceSeverity";
import {
  WorkRecordChip,
  WorkRecordDock,
  WorkRecordPane,
  WorkRecordSection,
  WorkRecordShell,
  WorkRecordStat,
  WorkRecordStats,
  WorkRecordTablePanel,
  WorkRecordTitle
} from "~/components/WorkRecord";
import {
  getActiveMaintenanceEventByEmployee,
  getMaintenanceDispatch,
  getMaintenanceDispatchEvents,
  getMaintenanceDispatchItems,
  getMaintenanceDispatchItemTrackedEntities,
  getWorkCenterReplacementParts
} from "~/services/maintenance.service";
import type {
  maintenanceDispatchPriority,
  maintenanceSeverity
} from "~/services/models";
import { useItems } from "~/stores";
import type { Handle } from "~/utils/handle";
import { recordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [
    { table: "maintenanceDispatch", column: "id", param: "dispatchId" }
  ]
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(data?.dispatch?.maintenanceDispatchId, "Maintenance Dispatch");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const { dispatchId } = params;

  if (!dispatchId) {
    throw new Error("Dispatch ID is required");
  }

  const [dispatch, events, items, activeEvent] = await Promise.all([
    getMaintenanceDispatch(client, dispatchId),
    getMaintenanceDispatchEvents(client, dispatchId),
    getMaintenanceDispatchItems(client, dispatchId),
    getActiveMaintenanceEventByEmployee(client, {
      dispatchId,
      employeeId: userId,
      companyId
    })
  ]);

  // Fetch replacement parts for the work center if available
  let replacementParts: Awaited<
    ReturnType<typeof getWorkCenterReplacementParts>
  >["data"] = [];
  if (dispatch.data?.workCenterId) {
    const parts = await getWorkCenterReplacementParts(
      client,
      dispatch.data.workCenterId
    );
    replacementParts = parts.data ?? [];
  }

  // Tracked entities for every item, in one read
  const trackedEntities = items.data?.length
    ? await getMaintenanceDispatchItemTrackedEntities(
        client,
        items.data.map((item) => item.id)
      )
    : null;
  const trackedEntitiesByItem = groupBy(
    trackedEntities?.data ?? [],
    (row) => row.maintenanceDispatchItemId
  );
  const itemTrackedEntities = Object.fromEntries(
    (items.data ?? []).map((item) => [
      item.id,
      trackedEntitiesByItem[item.id] ?? []
    ])
  );

  return {
    dispatch: dispatch.data,
    events: events.data ?? [],
    items: items.data ?? [],
    activeEvent: activeEvent.data,
    replacementParts,
    itemTrackedEntities,
    userId
  };
}

function getPriorityIcon(
  priority: (typeof maintenanceDispatchPriority)[number]
) {
  switch (priority) {
    case "Critical":
      return <BsExclamationSquareFill className="text-red-500 h-5 w-5" />;
    case "High":
      return <HighPriorityIcon className="h-5 w-5" />;
    case "Medium":
      return <MediumPriorityIcon className="h-5 w-5" />;
    case "Low":
      return <LowPriorityIcon className="h-5 w-5" />;
  }
}

type MaintenanceStatusProps = {
  status?: Database["public"]["Enums"]["maintenanceDispatchStatus"];
  className?: string;
};

function MaintenanceStatus({ status, className }: MaintenanceStatusProps) {
  switch (status) {
    case "Open":
      return (
        <Status color="gray" className={className}>
          {status}
        </Status>
      );
    case "Assigned":
      return (
        <Status color="yellow" className={className}>
          {status}
        </Status>
      );
    case "In Progress":
      return (
        <Status color="blue" className={className}>
          {status}
        </Status>
      );
    case "Completed":
      return (
        <Status color="green" className={className}>
          {status}
        </Status>
      );
    case "Cancelled":
      return (
        <Status color="red" className={className}>
          {status}
        </Status>
      );
    default:
      return null;
  }
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

const eventValidator = z.object({
  action: z.enum(["Start", "End", "Complete"]),
  dispatchId: z.string(),
  workCenterId: z.string().optional(),
  eventId: z.string().optional()
});

const deletePartValidator = z.object({
  action: z.literal("delete"),
  itemId: z.string().min(1, "Item is required")
});

export default function MaintenanceDetailRoute() {
  const { dispatch, events, items, activeEvent } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const fetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const addPartModal = useDisclosure();
  const [tab, setTab] = useState("details");
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [allItems] = useItems();

  // Create item options for the combobox
  const itemOptions = useMemo(() => {
    return allItems.map((item) => ({
      value: item.id,
      label: item.name,
      helper: item.readableIdWithRevision
    }));
  }, [allItems]);

  // Check if user has an active event on THIS dispatch
  const myActiveEvent = useMemo(() => {
    if (!activeEvent) return null;
    if (activeEvent.maintenanceDispatchId === dispatch?.id) {
      return activeEvent;
    }
    return null;
  }, [activeEvent, dispatch?.id]);

  const isWorking = !!myActiveEvent;
  const isCompleted = dispatch?.status === "Completed";
  const isBusy = fetcher.state !== "idle";

  // Calculate total time worked
  const totalDuration = useMemo(() => {
    return events.reduce((total, event) => {
      return total + (event.duration ?? 0);
    }, 0);
  }, [events]);

  if (!dispatch) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center">
        <span className="text-muted-foreground">
          <Trans>Dispatch not found</Trans>
        </span>
      </div>
    );
  }

  const procedure = dispatch.procedure as {
    name: string;
    content: JSONContent | null;
  } | null;
  const hasProcedure =
    !!procedure?.content && Object.keys(procedure.content).length > 0;
  const hasDescription =
    !!dispatch.content && !isRichTextEmpty(dispatch.content as JSONContent);
  const priority =
    dispatch.priority as (typeof maintenanceDispatchPriority)[number];

  const submitComplete = () => {
    const formData = new FormData();
    formData.append("action", "Complete");
    formData.append("dispatchId", dispatch.id);
    formData.append("eventId", myActiveEvent?.id ?? "");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.maintenanceEvent
    });
  };

  const properties = [
    {
      label: <Trans>Assignee</Trans>,
      value: dispatch.assignee ? (
        <EmployeeAvatar employeeId={dispatch.assignee} size="xs" />
      ) : (
        <span className="text-muted-foreground">
          <Trans>Unassigned</Trans>
        </span>
      )
    },
    {
      label: <Trans>Failure Mode</Trans>,
      value: dispatch.suspectedFailureMode?.name ?? (
        <span className="text-muted-foreground">
          <Trans>Not set</Trans>
        </span>
      )
    }
  ];

  const dock = isCompleted ? (
    <WorkRecordDock
      properties={properties}
      actions={
        <div className="flex flex-col items-center gap-1 rounded-lg border bg-card p-3 text-center">
          <LuCheck className="size-6 text-emerald-500" />
          <MaintenanceStatus status={dispatch.status} />
          <span className="text-xs text-muted-foreground">
            <Trans>Total time: {formatDuration(totalDuration)}</Trans>
          </span>
        </div>
      }
      compactActions={<MaintenanceStatus status={dispatch.status} />}
    />
  ) : (
    <WorkRecordDock
      properties={properties}
      clock={
        <ValidatedForm
          method="post"
          action={path.to.maintenanceEvent}
          validator={eventValidator}
          fetcher={fetcher}
          defaultValues={{
            action: isWorking ? "End" : "Start",
            dispatchId: dispatch.id,
            workCenterId: dispatch.workCenterId ?? undefined,
            eventId: myActiveEvent?.id
          }}
        >
          <Hidden name="dispatchId" value={dispatch.id} />
          <Hidden name="workCenterId" value={dispatch.workCenterId ?? ""} />
          <Hidden name="eventId" value={myActiveEvent?.id ?? ""} />
          <Hidden name="action" value={isWorking ? "End" : "Start"} />
          {isWorking ? (
            <PauseButton
              type="submit"
              disabled={isBusy}
              aria-label={t`Pause maintenance`}
            />
          ) : (
            <PlayButton
              type="submit"
              disabled={isBusy}
              aria-label={t`Start maintenance`}
            />
          )}
        </ValidatedForm>
      }
      caption={
        isWorking ? (
          <>
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 max-md:leading-tight">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
              <span>
                <Trans>Working</Trans>
              </span>
            </span>
            {myActiveEvent?.startTime && (
              <span className="text-sm text-muted-foreground">
                <Trans>
                  since{" "}
                  <DateTime value={myActiveEvent.startTime} variant="time" />
                </Trans>
              </span>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            <Trans>Start work</Trans>
          </span>
        )
      }
      actions={
        <Button
          size="lg"
          variant="secondary"
          className="w-full"
          leftIcon={<FaCheck />}
          isDisabled={isBusy}
          onClick={submitComplete}
        >
          <Trans>Complete</Trans>
        </Button>
      }
      compactActions={
        <IconButtonWithTooltip
          icon={<FaCheck />}
          tooltip={t`Complete`}
          disabled={isBusy}
          onClick={() => setConfirmComplete(true)}
        />
      }
    />
  );

  return (
    <>
      <WorkRecordShell
        recordId={dispatch.maintenanceDispatchId}
        back={{ to: path.to.maintenance, label: <Trans>Maintenance</Trans> }}
        tabs={[
          { value: "details", label: <Trans>Details</Trans> },
          {
            value: "procedure",
            label: <Trans>Procedure</Trans>,
            disabled: !hasProcedure
          }
        ]}
        tab={tab}
        onTabChange={setTab}
        chips={
          <>
            <MaintenanceStatus status={dispatch.status} />
            <WorkRecordChip icon={<LuFactory />}>
              {dispatch.workCenter?.name ?? t`Unknown`}
            </WorkRecordChip>
            <MaintenanceSeverity
              severity={
                dispatch.severity as (typeof maintenanceSeverity)[number]
              }
            />
            <WorkRecordChip icon={<LuInbox />}>
              {dispatch.source}
            </WorkRecordChip>
            <WorkRecordChip icon={getPriorityIcon(priority)}>
              {priority}
            </WorkRecordChip>
            {dispatch.plannedStartTime && (
              <WorkRecordChip icon={<LuCalendarClock />}>
                <DateTime value={dispatch.plannedStartTime} variant="date" />
              </WorkRecordChip>
            )}
          </>
        }
        dock={dock}
      >
        <WorkRecordPane value="details">
          <WorkRecordTitle
            title={dispatch.workCenter?.name ?? t`Unknown`}
            subtitle={dispatch.maintenanceSchedule?.name}
          />
          <WorkRecordStats>
            <WorkRecordStat
              title={<Trans>Time Worked</Trans>}
              icon={<LuTimer className="h-3 w-3 text-muted-foreground" />}
            >
              <Heading size="h1" className="font-sans">
                {formatDuration(totalDuration)}
              </Heading>
            </WorkRecordStat>
            <WorkRecordStat
              title={<Trans>Impact</Trans>}
              icon={<LuGauge className="h-3 w-3 text-muted-foreground" />}
            >
              <VStack spacing={1} className="justify-start">
                <MaintenanceOeeImpact oeeImpact={dispatch.oeeImpact} />
                {dispatch.takesWorkCenterOffline && (
                  <span className="text-muted-foreground text-sm">
                    <Trans>Takes the work center offline</Trans>
                  </span>
                )}
              </VStack>
            </WorkRecordStat>
            <WorkRecordStat
              title={<Trans>Planned</Trans>}
              icon={
                <LuCalendarClock className="h-3 w-3 text-muted-foreground" />
              }
              className="max-xl:col-span-2"
            >
              {dispatch.plannedStartTime ? (
                <VStack spacing={0} className="justify-start">
                  <Heading size="h3" className="w-full truncate font-sans">
                    <DateTime
                      value={dispatch.plannedStartTime}
                      variant="date"
                    />
                  </Heading>
                  {dispatch.plannedEndTime && (
                    <span className="text-muted-foreground text-sm">
                      <Trans>
                        Until{" "}
                        <DateTime
                          value={dispatch.plannedEndTime}
                          variant="absolute"
                        />
                      </Trans>
                    </span>
                  )}
                </VStack>
              ) : (
                <span className="text-muted-foreground text-sm">
                  <Trans>Not scheduled</Trans>
                </span>
              )}
            </WorkRecordStat>
          </WorkRecordStats>

          {hasDescription && (
            <WorkRecordSection title={<Trans>Description</Trans>}>
              {/* generateHTML is empty on the server, and hydration keeps that
                  empty markup, so the description renders on the client only. */}
              <ClientOnly fallback={null}>
                {() => (
                  <div
                    className="prose dark:prose-invert prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: generateHTML(
                        (dispatch.content ?? {}) as JSONContent
                      )
                    }}
                  />
                )}
              </ClientOnly>
            </WorkRecordSection>
          )}

          {(!isCompleted || items.length > 0) && (
            <WorkRecordSection
              title={
                isCompleted ? (
                  <Trans>Spare Parts Used</Trans>
                ) : (
                  <Trans>Spare Parts</Trans>
                )
              }
              action={
                !isCompleted && (
                  <Button
                    leftIcon={<LuCirclePlus />}
                    variant="secondary"
                    size="lg"
                    onClick={addPartModal.onOpen}
                  >
                    <Trans>Add Part</Trans>
                  </Button>
                )
              }
            >
              <WorkRecordTablePanel>
                <Table className="w-full text-base">
                  <Thead className="bg-muted/40">
                    <Tr>
                      <Th className="text-sm">
                        <Trans>Part</Trans>
                      </Th>
                      <Th className="text-sm">
                        <Trans>Quantity</Trans>
                      </Th>
                      <Th className="text-sm" />
                    </Tr>
                  </Thead>
                  <Tbody className="[&>tr:last-child]:border-0 [&>tr]:border-b">
                    {items.length > 0 ? (
                      items.map((item) => (
                        <Tr key={item.id} className="[&>td]:py-3">
                          <Td className="font-medium">{item.item?.name}</Td>
                          <Td className="tabular-nums">
                            {item.quantity} {item.unitOfMeasureCode}
                          </Td>
                          <Td className="text-right">
                            {!isCompleted && (
                              <ValidatedForm
                                method="post"
                                action={path.to.maintenanceDispatchItem(
                                  dispatch.id
                                )}
                                validator={deletePartValidator}
                                fetcher={deleteFetcher}
                              >
                                <Hidden name="action" value="delete" />
                                <Hidden name="itemId" value={item.id} />
                                <IconButton
                                  type="submit"
                                  aria-label={t`Remove part`}
                                  size="lg"
                                  variant="ghost"
                                  icon={<LuX className="h-4 w-4" />}
                                  isDisabled={deleteFetcher.state !== "idle"}
                                />
                              </ValidatedForm>
                            )}
                          </Td>
                        </Tr>
                      ))
                    ) : (
                      <Tr>
                        <Td
                          colSpan={3}
                          className="py-8 text-muted-foreground text-center"
                        >
                          <Trans>No spare parts added yet</Trans>
                        </Td>
                      </Tr>
                    )}
                  </Tbody>
                </Table>
              </WorkRecordTablePanel>
            </WorkRecordSection>
          )}

          {events.length > 0 && (
            <WorkRecordSection title={<Trans>Time Entries</Trans>}>
              <WorkRecordTablePanel>
                <Table className="w-full text-base">
                  <Thead className="bg-muted/40">
                    <Tr>
                      <Th className="text-sm">
                        <Trans>Employee</Trans>
                      </Th>
                      <Th className="text-sm">
                        <Trans>When</Trans>
                      </Th>
                      <Th className="text-sm text-right">
                        <Trans>Duration</Trans>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody className="[&>tr:last-child]:border-0 [&>tr]:border-b">
                    {events.map((event) => (
                      <Tr key={event.id} className="[&>td]:py-3">
                        <Td>
                          <EmployeeAvatar
                            employeeId={event.employeeId}
                            size="xs"
                          />
                        </Td>
                        <Td className="text-sm">
                          <DateTime
                            value={event.startTime}
                            variant="absolute"
                          />
                          {event.endTime && (
                            <>
                              {" - "}
                              <DateTime value={event.endTime} variant="time" />
                            </>
                          )}
                        </Td>
                        <Td className="text-right font-mono text-sm">
                          {event.duration
                            ? formatDuration(event.duration)
                            : t`Active`}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </WorkRecordTablePanel>
            </WorkRecordSection>
          )}
        </WorkRecordPane>

        <WorkRecordPane value="procedure">
          {hasProcedure && procedure && (
            <WorkRecordSection title={procedure.name}>
              <ClientOnly fallback={null}>
                {() => (
                  <div
                    className="prose dark:prose-invert prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: generateHTML(
                        (procedure.content ?? {}) as JSONContent
                      )
                    }}
                  />
                )}
              </ClientOnly>
            </WorkRecordSection>
          )}
        </WorkRecordPane>
      </WorkRecordShell>

      {/* Add Part Modal */}
      <MaintenanceAddPartModal
        open={addPartModal.isOpen}
        dispatchId={dispatch.id}
        itemOptions={itemOptions}
        onClose={addPartModal.onClose}
      />
      <Modal
        open={confirmComplete}
        onOpenChange={(open) => {
          if (!open) setConfirmComplete(false);
        }}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{t`Complete ${dispatch.maintenanceDispatchId}?`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Trans>This marks the dispatch as completed.</Trans>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmComplete(false)}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              isLoading={isBusy}
              onClick={() => {
                submitComplete();
                setConfirmComplete(false);
              }}
            >
              <Trans>Complete</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
