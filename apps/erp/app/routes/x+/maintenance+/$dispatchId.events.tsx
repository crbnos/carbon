// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuPlay, LuSquare } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { z } from "zod";
import { DateTime, EmployeeAvatar } from "~/components";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { maintenanceDispatchEventValidator } from "~/modules/resources/resources.models";
import type { MaintenanceDispatchEvent } from "~/modules/resources/types";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const intent = (await args.request.clone().formData()).get("intent");

  if (intent === "start") {
    const input = await validator().request(args, { params: ["dispatchId"] });
    if ("invalid" in input) return input.invalid;
    const api = await carbon(args.request);
    return api.resources.startMaintenanceEvent({
      dispatchId: input.params.dispatchId
    });
  }

  if (intent === "stop") {
    const input = await validator(z.object({ eventId: z.string() })).request(
      args,
      { params: ["dispatchId"] }
    );
    if ("invalid" in input) return input.invalid;
    const api = await carbon(args.request);
    return api.resources.stopMaintenanceEvent({
      dispatchId: input.params.dispatchId,
      eventId: input.data.eventId
    });
  }

  // The timecard drawer: an id edits that timecard, none adds one.
  const input = await validator(maintenanceDispatchEventValidator).request(
    args,
    { params: ["dispatchId"] }
  );
  if ("invalid" in input) return input.invalid;
  const { id, ...event } = input.data;
  const maintenanceDispatchId = input.params.dispatchId;
  const api = await carbon(args.request);
  return id
    ? api.resources.updateMaintenanceEvent({
        ...event,
        id,
        maintenanceDispatchId
      })
    : api.resources.createMaintenanceEvent({
        ...event,
        maintenanceDispatchId
      });
}

export default function MaintenanceDispatchEventsRoute() {
  const { dispatchId } = useParams();
  if (!dispatchId) throw new Error("dispatchId not found");

  const { t } = useLingui();
  const user = useUser();
  const permissions = usePermissions();
  const start = useAction<typeof action>({
    onSuccess: () => toast.success(t`Event started`)
  });
  const stop = useAction<typeof action>({
    onSuccess: ({ data }) => {
      toast.success(t`Event stopped`);
      if (data && "warning" in data && typeof data.warning === "string") {
        toast.error(data.warning);
      }
    }
  });

  const routeData = useRouteData<{
    events: MaintenanceDispatchEvent[];
  }>(path.to.maintenanceDispatch(dispatchId));

  const events = routeData?.events ?? [];
  const activeEvent = events.find(
    (e) => e.employee?.id === user.id && !e.endTime
  );

  return (
    <VStack spacing={4}>
      <HStack className="justify-between w-full">
        <h2 className="text-lg font-semibold">Time Events</h2>
        {permissions.can("update", "resources") &&
          (activeEvent ? (
            <stop.Form method="post">
              <input type="hidden" name="intent" value="stop" />
              <input type="hidden" name="eventId" value={activeEvent.id} />
              <Button
                type="submit"
                variant="secondary"
                leftIcon={<LuSquare />}
                isLoading={stop.isPending}
              >
                Stop Timer
              </Button>
            </stop.Form>
          ) : (
            <start.Form method="post">
              <input type="hidden" name="intent" value="start" />
              <Button
                type="submit"
                variant="primary"
                leftIcon={<LuPlay />}
                isLoading={start.isPending}
              >
                Start Timer
              </Button>
            </start.Form>
          ))}
      </HStack>

      {events.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No time events recorded yet. Click "Start Timer" to begin tracking
            time.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <Card key={event.id}>
              <CardHeader className="pb-2">
                <HStack className="justify-between">
                  <HStack>
                    <EmployeeAvatar employeeId={event.employee?.id} size="xs" />
                    <span className="text-sm font-medium">
                      {event.employee?.fullName ?? "Unknown"}
                    </span>
                  </HStack>
                  {!event.endTime && (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                      In Progress
                    </span>
                  )}
                </HStack>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Start:</span>{" "}
                    <DateTime value={event.startTime} variant="absolute" />
                  </div>
                  <div>
                    <span className="text-muted-foreground">End:</span>{" "}
                    {event.endTime ? (
                      <DateTime value={event.endTime} variant="absolute" />
                    ) : (
                      "-"
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration:</span>{" "}
                    {event.duration ? `${event.duration} min` : "-"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Work Center:</span>{" "}
                    {event.workCenter?.name ?? "-"}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </VStack>
  );
}
