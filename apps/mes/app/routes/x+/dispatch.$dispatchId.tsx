// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { Hidden, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ClientOnly,
  cn,
  generateHTML,
  Heading,
  HStack,
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
  SidebarTrigger,
  Status,
  useDisclosure,
  useViewport,
  VStack
} from "@carbon/react";
import { groupBy } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { FaCheck, FaPause, FaPlay } from "react-icons/fa6";
import { LuArrowLeft, LuCheck, LuCirclePlus, LuX } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { DateTime } from "~/components";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import { MaintenanceAddPartModal } from "~/components/MaintenanceDispatch";
import MaintenanceOeeImpact from "~/components/MaintenanceOeeImpact";
import MaintenanceSeverity from "~/components/MaintenanceSeverity";
import { MesAppBar } from "~/components/MesAppBar";
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
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [
    { table: "maintenanceDispatch", column: "id", param: "dispatchId" }
  ]
};

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
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [allItems] = useItems();
  const { isPhone } = useViewport();

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

  return (
    <div className="flex flex-col flex-1">
      <MesAppBar
        title={dispatch.maintenanceDispatchId}
        subtitle={<Trans>Maintenance</Trans>}
        back={{ to: path.to.maintenance }}
      />
      {!isPhone && (
        <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-card max-md:hidden">
          <div className="flex items-center gap-2 px-2 w-full justify-between">
            <HStack>
              <SidebarTrigger />
              <Link to={path.to.maintenance}>
                <Button variant="ghost" size="sm">
                  <LuArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <Heading size="h4">{dispatch.maintenanceDispatchId}</Heading>
              <MaintenanceStatus status={dispatch.status} />
            </HStack>
            <HStack>
              {getPriorityIcon(
                dispatch.priority as (typeof maintenanceDispatchPriority)[number]
              )}
            </HStack>
          </div>
        </header>
      )}

      <main className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent p-4">
        <VStack spacing={4} className="max-w-2xl mx-auto">
          <div className="flex w-full items-center justify-between md:hidden">
            <MaintenanceStatus status={dispatch.status} />
            {getPriorityIcon(
              dispatch.priority as (typeof maintenanceDispatchPriority)[number]
            )}
          </div>
          {/* Work Center & OEE Impact */}
          <Card className="w-full">
            <CardHeader className="max-md:hidden">
              <CardTitle className="text-sm text-muted-foreground font-normal">
                <Trans>Work Center</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VStack spacing={2} className="items-start">
                <span className="hidden text-xs text-muted-foreground max-md:block">
                  <Trans>Work Center</Trans>
                </span>
                <span className="text-lg font-semibold">
                  {dispatch.workCenter?.name ?? t`Unknown`}
                </span>
                <HStack>
                  <MaintenanceOeeImpact oeeImpact={dispatch.oeeImpact} />
                  <MaintenanceSeverity
                    severity={
                      dispatch.severity as (typeof maintenanceSeverity)[number]
                    }
                  />
                </HStack>
              </VStack>
            </CardContent>
          </Card>

          {/* Description */}
          {dispatch.content &&
            Object.keys(dispatch.content as object).length > 0 && (
              <Card
                className={cn(
                  "w-full",
                  isRichTextEmpty(dispatch.content as JSONContent) &&
                    "max-md:hidden"
                )}
              >
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground font-normal">
                    <Trans>Description</Trans>
                  </CardTitle>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>
            )}

          {/* Time Tracking Controls */}
          {!isCompleted && (
            <Card className="w-full">
              <CardHeader className="max-md:hidden">
                <CardTitle>
                  <span className="text-sm text-muted-foreground">
                    <Trans>Time Worked: {formatDuration(totalDuration)}</Trans>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 max-md:pt-4">
                <p className="mb-3 text-xs text-muted-foreground md:hidden">
                  <Trans>Time Worked: {formatDuration(totalDuration)}</Trans>
                </p>
                <VStack spacing={4}>
                  <HStack
                    spacing={4}
                    className="justify-center w-full max-md:flex-col max-md:space-x-0 max-md:gap-3"
                  >
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
                      <Hidden
                        name="workCenterId"
                        value={dispatch.workCenterId ?? ""}
                      />
                      <Hidden name="eventId" value={myActiveEvent?.id ?? ""} />
                      <Hidden
                        name="action"
                        value={isWorking ? "End" : "Start"}
                      />
                      <button
                        type="submit"
                        disabled={fetcher.state !== "idle"}
                        className={`group size-24 flex flex-row items-center gap-2 justify-center rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:scale-105 transition-all text-white text-3xl border-b-4 active:border-b-0 active:translate-y-1 disabled:bg-gray-500 disabled:hover:bg-gray-600 disabled:border-gray-700 ${
                          isWorking
                            ? "bg-red-500 hover:bg-red-600 border-red-700"
                            : "bg-emerald-500 hover:bg-emerald-600 border-emerald-700"
                        }`}
                      >
                        {isWorking ? (
                          <FaPause className="group-hover:scale-110" />
                        ) : (
                          <FaPlay className="group-hover:scale-110" />
                        )}
                      </button>
                    </ValidatedForm>

                    {/* Desktop completes on click, as before; phones confirm
                        first (the button below). */}
                    <ValidatedForm
                      method="post"
                      action={path.to.maintenanceEvent}
                      validator={eventValidator}
                      fetcher={fetcher}
                      defaultValues={{
                        action: "Complete",
                        dispatchId: dispatch.id,
                        eventId: myActiveEvent?.id
                      }}
                      className="max-md:hidden"
                    >
                      <Hidden name="dispatchId" value={dispatch.id} />
                      <Hidden name="eventId" value={myActiveEvent?.id ?? ""} />
                      <Hidden name="action" value="Complete" />
                      <button
                        type="submit"
                        aria-label={t`Complete`}
                        disabled={fetcher.state !== "idle"}
                        className="group size-24 flex flex-row items-center gap-2 justify-center bg-accent rounded-full shadow-lg hover:cursor-pointer hover:shadow-xl hover:scale-105 transition-all text-accent-foreground text-3xl disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-30"
                      >
                        <FaCheck className="group-hover:scale-110" />
                      </button>
                    </ValidatedForm>
                    <Button
                      size="lg"
                      variant="secondary"
                      leftIcon={<LuCheck />}
                      isDisabled={fetcher.state !== "idle"}
                      onClick={() => setConfirmComplete(true)}
                      className="hidden w-full max-md:flex max-md:h-12"
                    >
                      <Trans>Complete</Trans>
                    </Button>
                  </HStack>
                </VStack>
              </CardContent>
            </Card>
          )}

          {/* Time Entries */}
          {events.length > 0 && (
            <Card className="w-full">
              <CardHeader>
                <CardTitle>
                  <Trans>Time Entries</Trans>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="w-full divide-y">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="py-2 flex justify-between items-center"
                    >
                      <VStack spacing={2} className="items-start">
                        <EmployeeAvatar
                          employeeId={event.employeeId}
                          size="xs"
                        />
                        <span className="text-xs text-muted-foreground">
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
                        </span>
                      </VStack>
                      <span className="text-sm font-mono">
                        {event.duration
                          ? formatDuration(event.duration)
                          : t`Active`}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Spare Parts */}
          {!isCompleted && (
            <Card className="w-full">
              <CardHeader>
                <HStack className="justify-between w-full">
                  <CardTitle className="text-sm font-medium">
                    <Trans>Spare Parts</Trans>
                  </CardTitle>
                  <Button
                    variant="secondary"
                    leftIcon={<LuCirclePlus />}
                    className="max-md:h-11"
                    onClick={addPartModal.onOpen}
                  >
                    <Trans>Add</Trans>
                  </Button>
                </HStack>
              </CardHeader>
              <CardContent>
                {items.length > 0 && (
                  <div className="w-full divide-y">
                    {items.map((item) => {
                      return (
                        <div key={item.id} className="py-2">
                          <div className="flex justify-between items-center">
                            <VStack spacing={0} className="items-start">
                              <span className="text-sm">{item.item?.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {item.quantity} {item.unitOfMeasureCode}
                              </span>
                            </VStack>
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
                                size="sm"
                                className="max-md:size-11"
                                variant="ghost"
                                icon={<LuX className="h-4 w-4" />}
                                isDisabled={deleteFetcher.state !== "idle"}
                              />
                            </ValidatedForm>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {items.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    <Trans>No spare parts added yet</Trans>
                  </span>
                )}
              </CardContent>
            </Card>
          )}

          {/* Materials (when completed) */}
          {isCompleted && items.length > 0 && (
            <Card className="w-full">
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  <Trans>Spare Parts Used</Trans>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="w-full divide-y">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="py-2 flex justify-between items-center"
                    >
                      <span className="text-sm">{item.item?.name}</span>
                      <span className="text-sm font-mono">
                        {item.quantity} {item.unitOfMeasureCode}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Procedure */}
          {dispatch.procedure &&
            (dispatch.procedure as any).content &&
            Object.keys((dispatch.procedure as any).content as object).length >
              0 && (
              <Card className="w-full">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground font-normal">
                    <Trans>Procedure</Trans>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-sm font-medium mb-2 block">
                    {(dispatch.procedure as any)?.name}
                  </span>
                  <ClientOnly fallback={null}>
                    {() => (
                      <div
                        className="prose dark:prose-invert prose-sm max-w-none"
                        dangerouslySetInnerHTML={{
                          __html: generateHTML(
                            ((dispatch.procedure as any).content ??
                              {}) as JSONContent
                          )
                        }}
                      />
                    )}
                  </ClientOnly>
                </CardContent>
              </Card>
            )}

          {/* Completed State */}
          {isCompleted && (
            <Card className="w-full bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800">
              <CardContent className="pt-6">
                <VStack spacing={2}>
                  <LuCheck className="h-8 w-8 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <Trans>Maintenance Completed</Trans>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <Trans>Total time: {formatDuration(totalDuration)}</Trans>
                  </span>
                </VStack>
              </CardContent>
            </Card>
          )}
        </VStack>
      </main>

      {/* Add Part Modal */}
      {addPartModal.isOpen && (
        <MaintenanceAddPartModal
          dispatchId={dispatch.id}
          itemOptions={itemOptions}
          onClose={addPartModal.onClose}
        />
      )}
      {confirmComplete && (
        <Modal
          open
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
                isLoading={fetcher.state !== "idle"}
                onClick={() => {
                  const formData = new FormData();
                  formData.append("action", "Complete");
                  formData.append("dispatchId", dispatch.id);
                  formData.append("eventId", myActiveEvent?.id ?? "");
                  fetcher.submit(formData, {
                    method: "post",
                    action: path.to.maintenanceEvent
                  });
                  setConfirmComplete(false);
                }}
              >
                <Trans>Complete</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </div>
  );
}
