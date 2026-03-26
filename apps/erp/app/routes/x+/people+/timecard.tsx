import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, Outlet, redirect, useLoaderData } from "react-router";
import { getTimecardEntries, getWeeklyTimecardSummary } from "~/modules/people";
import { TimecardsTable } from "~/modules/people/ui/Timecards";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

function getWeekBounds(offset = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    from: monday.toISOString(),
    to: sunday.toISOString(),
    monday,
    sunday
  };
}

function formatMinutes(totalMinutes: number | null) {
  if (totalMinutes === null) return "—";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatAverageClock(minutes: number | null) {
  if (minutes === null) return "—";
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getAnomalyDescription(row: {
  missedPunchCount: number;
  openEntryCount?: number;
  openBreakCount?: number;
}) {
  if (row.missedPunchCount === 0) {
    return "No anomalies detected this week.";
  }

  const parts: string[] = [];
  if ((row.openEntryCount ?? 0) > 0) {
    parts.push(
      `${row.openEntryCount} open shift${row.openEntryCount === 1 ? "" : "s"}`
    );
  }
  if ((row.openBreakCount ?? 0) > 0) {
    parts.push(
      `${row.openBreakCount} open break${row.openBreakCount === 1 ? "" : "s"}`
    );
  }

  return parts.length > 0
    ? `Anomalies: ${parts.join(", ")}.`
    : `${row.missedPunchCount} anomaly flag${row.missedPunchCount === 1 ? "" : "s"} detected.`;
}

export const handle: Handle = {
  breadcrumb: "Timecards",
  to: path.to.peopleTimecard
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const companySettings = await getCompanySettings(client, companyId);
  if (!companySettings.data?.timeCardEnabled) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(
          null,
          "Timecards are not enabled. To enable this feature, go to Settings → People to enable Timecards."
        )
      )
    );
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const weekOffset = parseInt(searchParams.get("week") ?? "0", 10);
  const { from, monday, sunday } = getWeekBounds(weekOffset);
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [entries, summary] = await Promise.all([
    getTimecardEntries(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getWeeklyTimecardSummary(client, {
      companyId,
      weekStart: from
    })
  ]);

  if (entries.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(entries.error, "Failed to load timecard entries")
      )
    );
  }

  return {
    entries: entries.data ?? [],
    count: entries.count ?? 0,
    summary,
    weekOffset,
    monday: monday.toISOString(),
    sunday: sunday.toISOString()
  };
}

export default function Route() {
  const { entries, count, summary, weekOffset, monday, sunday } =
    useLoaderData<typeof loader>();
  const isCurrentWeek = weekOffset === 0;

  return (
    <VStack spacing={0} className="h-full">
      <Card className="m-4">
        <CardHeader>
          <HStack className="justify-between items-center">
            <CardTitle>Weekly Summary</CardTitle>
            <HStack className="gap-2">
              <Button variant="outline" asChild leftIcon={<LuChevronLeft />}>
                <Link to={`${path.to.peopleTimecard}?week=${weekOffset - 1}`}>
                  Prev
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground">
                {formatDate(monday, { dateStyle: "medium" })} -{" "}
                {formatDate(sunday, { dateStyle: "medium" })}
              </span>
              <Button
                variant="outline"
                disabled={isCurrentWeek}
                asChild={!isCurrentWeek}
                rightIcon={<LuChevronRight />}
              >
                {isCurrentWeek ? (
                  <span>Next</span>
                ) : (
                  <Link to={`${path.to.peopleTimecard}?week=${weekOffset + 1}`}>
                    Next
                  </Link>
                )}
              </Button>
            </HStack>
          </HStack>
        </CardHeader>
        <CardContent>
          <TableBase>
            <Thead>
              <Tr>
                <Th>Employee</Th>
                <Th>Worked</Th>
                <Th>Overtime</Th>
                <Th>Break Time</Th>
                <Th>Avg Break</Th>
                <Th>Avg First Punch</Th>
                <Th>Anomalies</Th>
              </Tr>
            </Thead>
            <Tbody>
              {summary.length === 0 ? (
                <Tr>
                  <Td
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
                  >
                    No weekly summary available
                  </Td>
                </Tr>
              ) : (
                summary.map((row) => (
                  <Tr key={row.employeeId}>
                    <Td>
                      <HStack className="gap-2 items-center">
                        <Avatar
                          className="size-6"
                          src={row.avatarUrl ?? undefined}
                          name={`${row.firstName ?? ""} ${row.lastName ?? ""}`}
                        />
                        <span>
                          {row.firstName} {row.lastName}
                        </span>
                      </HStack>
                    </Td>
                    <Td>{formatMinutes(row.totalWorkedMinutes)}</Td>
                    <Td>{formatMinutes(row.overtimeMinutes)}</Td>
                    <Td>{formatMinutes(row.breakMinutes)}</Td>
                    <Td>{formatMinutes(row.averageBreakMinutes)}</Td>
                    <Td>{formatAverageClock(row.averageFirstPunchMinutes)}</Td>
                    <Td>
                      <Badge
                        variant={
                          row.missedPunchCount > 0 ? "yellow" : "secondary"
                        }
                        title={getAnomalyDescription(row)}
                        aria-label={getAnomalyDescription(row)}
                      >
                        {row.missedPunchCount}
                      </Badge>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </TableBase>
        </CardContent>
      </Card>
      <TimecardsTable data={entries} count={count} />
      <Outlet />
    </VStack>
  );
}
