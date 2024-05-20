import {
  ClientOnly,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  cn,
  useDebounce,
} from "@carbon/react";
import type { Location } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/server-runtime";
import { typedjson, useTypedLoaderData } from "remix-typedjson";

import type { GanttEvent } from "~/components/Gantt";
import { Gantt } from "~/components/Gantt";
import { useReplaceLocation } from "~/hooks/useReplaceLocation";
import { requirePermissions } from "~/services/auth/auth.server";
import {
  getResizableGanttSettings,
  setResizableGanttSettings,
} from "~/utils/resizablePanel";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "scheduling",
  });

  const resizeSettings = await getResizableGanttSettings(request);

  return typedjson({
    trace: {
      events: [
        {
          id: "1",
          parentId: undefined,
          hasChildren: true,
          children: ["2", "3"],
          level: 0,
          data: {
            duration: 42000,
            offset: 0,
            level: "TRACE",
            message: "WO-012345",
            isPartial: false,
            isRoot: true,
            isError: false,
            style: {
              icon: "job",
            },
          },
        },
        {
          id: "2",
          parentId: "1",
          hasChildren: true,
          children: ["4"],
          level: 1,
          data: {
            duration: 10000,
            offset: 0,
            level: "TRACE",
            message: "Plasma",
            isPartial: false,
            isRoot: false,
            isError: false,
            style: {
              variant: "primary",
              icon: "operation",
            },
          },
        },
        {
          id: "4",
          parentId: "2",
          hasChildren: false,
          children: [],
          level: 2,
          data: {
            duration: 10000,
            offset: 0,
            level: "TRACE",
            message: "Timecard",
            isPartial: false,
            isRoot: false,
            isError: false,
            style: {
              variant: "primary",
              icon: "timecard",
              accessory: {
                style: "person",
                items: [
                  {
                    text: "Anne Barbin",
                  },
                ],
              },
            },
          },
        },
        {
          id: "3",
          parentId: "1",
          hasChildren: true,
          children: ["5", "6"],
          level: 1,
          data: {
            duration: 8000,
            offset: 13000,
            level: "TRACE",
            message: "Bend",
            isPartial: false,
            isRoot: false,
            isError: true,
            style: {
              variant: "primary",
              icon: "operation",
            },
          },
        },
        {
          id: "5",
          parentId: "3",
          hasChildren: false,
          children: [],
          level: 2,
          data: {
            duration: 8000,
            offset: 13000,
            level: "TRACE",
            message: "Timecard",
            isPartial: false,
            isRoot: false,
            isError: true,
            style: {
              variant: "primary",
              icon: "timecard",
              accessory: {
                style: "person",
                items: [
                  {
                    text: "Brad Barbin",
                  },
                ],
              },
            },
          },
        },
        {
          id: "6",
          parentId: "3",
          hasChildren: false,
          children: [],
          level: 2,
          data: {
            duration: 0,
            offset: 21000,
            level: "ERROR",
            message: "Inspection",
            isPartial: false,
            isRoot: false,
            isError: true,
            style: {
              icon: "inspection",
              variant: "primary",
              accessory: {
                style: "person",
                items: [
                  {
                    text: "Brigette Barbin",
                  },
                ],
              },
            },
          },
        },
        {
          id: "7",
          parentId: "1",
          hasChildren: true,
          children: ["8"],
          level: 1,
          data: {
            duration: 10000,
            offset: 21000,
            level: "TRACE",
            message: "Plasma",
            isPartial: false,
            isRoot: false,
            isError: false,
            style: {
              variant: "primary",
              icon: "operation",
            },
          },
        },
        {
          id: "8",
          parentId: "7",
          hasChildren: false,
          children: [],
          level: 2,
          data: {
            duration: 10000,
            offset: 21000,
            level: "TRACE",
            message: "Timecard",
            isPartial: false,
            isRoot: false,
            isError: false,
            style: {
              variant: "primary",
              icon: "timecard",
              accessory: {
                style: "person",
                items: [
                  {
                    text: "Anne Barbin",
                  },
                ],
              },
            },
          },
        },
        {
          id: "9",
          parentId: "1",
          hasChildren: true,
          children: ["10", "11"],
          level: 1,
          data: {
            duration: 8000,
            offset: 34000,
            level: "TRACE",
            message: "Bend",
            isPartial: false,
            isRoot: false,
            isError: false,
            style: {
              variant: "primary",
              icon: "operation",
            },
          },
        },
        {
          id: "10",
          parentId: "9",
          hasChildren: false,
          children: [],
          level: 2,
          data: {
            duration: 8000,
            offset: 34000,
            level: "TRACE",
            message: "Timecard",
            isPartial: false,
            isRoot: false,
            isError: false,
            style: {
              variant: "primary",
              icon: "timecard",
              accessory: {
                style: "person",
                items: [
                  {
                    text: "Brad Barbin",
                  },
                ],
              },
            },
          },
        },
        {
          id: "11",
          parentId: "9",
          hasChildren: false,
          children: [],
          level: 2,
          data: {
            duration: 0,
            offset: 42000,
            level: "LOG",
            message: "Inspection",
            isPartial: false,
            isRoot: false,
            isError: false,
            style: {
              icon: "inspection",
              variant: "primary",
              accessory: {
                style: "person",
                items: [
                  {
                    text: "Brigette Barbin",
                  },
                ],
              },
            },
          },
        },
      ] as GanttEvent[],
      parentReadableId: "",
      duration: 42000,
      rootSpanStatus: "completed" as const,
      rootStartedAt: new Date(),
    },
    resizeSettings,
  });
}

function getSpanId(location: Location<any>): string | undefined {
  const search = new URLSearchParams(location.search);
  return search.get("span") ?? undefined;
}

export default function GanttView() {
  const { trace, resizeSettings } = useTypedLoaderData<typeof loader>();

  const { location, replaceSearchParam } = useReplaceLocation();
  const selectedSpanId = getSpanId(location);

  const { events, parentReadableId, duration, rootSpanStatus, rootStartedAt } =
    trace;

  const changeToSpan = useDebounce((selectedSpan: string) => {
    replaceSearchParam("span", selectedSpan);
  }, 250);

  return (
    <div
      className={cn(
        "grid h-full max-h-full grid-cols-1 overflow-hidden bg-background"
      )}
    >
      <ClientOnly fallback={null}>
        {() => (
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full max-h-full"
            onLayout={(layout) => {
              if (layout.length !== 2) return;
              if (!selectedSpanId) return;
              setResizableGanttSettings(document, layout);
            }}
          >
            <ResizablePanel
              order={1}
              minSize={30}
              defaultSize={resizeSettings.layout?.[0]}
            >
              <Gantt
                selectedId={selectedSpanId}
                key={events[0]?.id ?? "-"}
                events={events}
                parentReadableId={parentReadableId}
                onSelectedIdChanged={(selectedSpan) => {
                  //instantly close the panel if no span is selected
                  if (!selectedSpan) {
                    replaceSearchParam("span");
                    return;
                  }

                  changeToSpan(selectedSpan);
                }}
                totalDuration={duration}
                rootSpanStatus={rootSpanStatus}
                rootStartedAt={rootStartedAt}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            {selectedSpanId && (
              <ResizablePanel
                order={2}
                minSize={30}
                defaultSize={resizeSettings.layout?.[1]}
              >
                {/* <SpanView
              runParam={run.readableId}
              spanId={selectedSpanId}
              closePanel={() => replaceSearchParam("span")}
            /> */}
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        )}
      </ClientOnly>
    </div>
  );
}
