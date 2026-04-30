import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuEllipsisVertical,
  LuPencil,
  LuPlay,
  LuTrash
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { useDateFormatter } from "~/hooks";
import {
  clockIn,
  clockOut,
  getOpenClockEntry,
  updateTimeCardEntry
} from "~/services/people.service";
import { path } from "~/utils/path";

function getWeekBounds(offset: number = 0) {
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

function formatDuration(clockInStr: string, clockOutStr: string | null) {
  const end = clockOutStr ? new Date(clockOutStr).getTime() : Date.now();
  const ms = end - new Date(clockInStr).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatTotalHours(
  entries: { clockIn: string; clockOut: string | null }[]
) {
  let totalMs = 0;
  for (const entry of entries) {
    const end = entry.clockOut
      ? new Date(entry.clockOut).getTime()
      : Date.now();
    totalMs += end - new Date(entry.clockIn).getTime();
  }
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatTime(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDay(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function toLocalDatetimeInput(dateStr: string) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const weekOffset = parseInt(url.searchParams.get("week") ?? "0", 10);
  const { from, to } = getWeekBounds(weekOffset);

  const [entries, openEntry] = await Promise.all([
    client
      .from("timeCardEntry")
      .select("*")
      .eq("employeeId", userId)
      .eq("companyId", companyId)
      .gte("clockIn", from)
      .lte("clockIn", to)
      .order("clockIn", { ascending: false }),
    getOpenClockEntry(client, userId, companyId)
  ]);

  return {
    entries: entries.data ?? [],
    openEntry: openEntry.data,
    weekOffset,
    from,
    to
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const result = await clockIn(client, {
      employeeId: userId,
      companyId,
      createdBy: userId
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "clockOut") {
    const result = await clockOut(client, {
      employeeId: userId,
      companyId,
      updatedBy: userId
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "updateEntry") {
    const entryId = formData.get("entryId") as string;
    const clockInVal = formData.get("clockIn") as string;
    const clockOutVal = formData.get("clockOut") as string | null;
    const result = await updateTimeCardEntry(client, {
      entryId,
      clockIn: clockInVal,
      clockOut: clockOutVal || null,
      updatedBy: userId
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "deleteEntry") {
    const entryId = formData.get("entryId") as string;
    const result = await client
      .from("timeCardEntry")
      .delete()
      .eq("id", entryId);
    return { success: !result.error, error: result.error?.message };
  }

  return { success: false, error: "Unknown intent" };
}

export default function MESTimecardPage() {
  const { entries, openEntry, weekOffset, from, to } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [, setTick] = useState(0);
  const { t } = useLingui();
  const { locale } = useLocale();
  const { formatDate } = useDateFormatter();
  const [deletingEntry, setDeletingEntry] = useState<{
    id: string;
    clockIn: string;
  } | null>(null);

  const monday = new Date(from);
  const sunday = new Date(to);
  const isCurrentWeek = weekOffset === 0;

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setEditingId(null);
    }
  }, [fetcher.data, fetcher.state]);

  function startEdit(entry: {
    id: string;
    clockIn: string;
    clockOut: string | null;
  }) {
    setEditingId(entry.id);
    setEditClockIn(toLocalDatetimeInput(entry.clockIn));
    setEditClockOut(entry.clockOut ? toLocalDatetimeInput(entry.clockOut) : "");
  }

  return (
    <div className="flex flex-col h-full w-full overflow-y-auto p-4 md:p-6">
      <div className="max-w-[60rem] mx-auto w-full">
        <Card className="overflow-hidden">
          <CardHeader>
            <HStack className="justify-between items-center">
              <CardTitle>
                <Trans>My Hours</Trans>
              </CardTitle>
              <HStack className="gap-1">
                {openEntry ? (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="clockOut" />
                    <Button
                      variant="destructive"
                      type="submit"
                      disabled={fetcher.state !== "idle"}
                    >
                      <Trans>Clock Out</Trans>
                    </Button>
                  </fetcher.Form>
                ) : (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="clockIn" />
                    <Button
                      leftIcon={<LuPlay />}
                      type="submit"
                      disabled={fetcher.state !== "idle"}
                    >
                      <Trans>Clock In</Trans>
                    </Button>
                  </fetcher.Form>
                )}
              </HStack>
            </HStack>
            {openEntry && (
              <Badge variant="green" className="w-fit">
                <Trans>
                  Clocked in since {formatTime(openEntry.clockIn, locale)}
                </Trans>
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center mb-4">
              <Button variant="outline" asChild leftIcon={<LuChevronLeft />}>
                <Link to={`${path.to.timeCardPage}?week=${weekOffset - 1}`}>
                  <Trans>Prev</Trans>
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground">
                {formatDate(monday.toISOString(), { dateStyle: "medium" })} —{" "}
                {formatDate(sunday.toISOString(), { dateStyle: "medium" })}
              </span>
              <Button
                variant="outline"
                disabled={isCurrentWeek}
                asChild={!isCurrentWeek}
                rightIcon={<LuChevronRight />}
              >
                {isCurrentWeek ? (
                  <span>
                    <Trans>Next</Trans>
                  </span>
                ) : (
                  <Link to={`${path.to.timeCardPage}?week=${weekOffset + 1}`}>
                    <Trans>Next</Trans>
                  </Link>
                )}
              </Button>
            </HStack>

            <TableBase className="table-fixed w-full">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[28%]" />
                <col className="w-[28%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
              </colgroup>
              <Thead>
                <Tr>
                  <Th className="whitespace-nowrap">
                    <Trans>Date</Trans>
                  </Th>
                  <Th>
                    <Trans>Clock In</Trans>
                  </Th>
                  <Th>
                    <Trans>Clock Out</Trans>
                  </Th>
                  <Th className="text-center">
                    <Trans>Duration</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {entries.length === 0 ? (
                  <Tr>
                    <Td
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      <Trans>No time entries for this week</Trans>
                    </Td>
                  </Tr>
                ) : (
                  entries.map((entry) =>
                    editingId === entry.id ? (
                      <Tr key={entry.id}>
                        <Td className="whitespace-nowrap">
                          {formatDay(entry.clockIn, locale)}
                        </Td>
                        <Td>
                          <Input
                            type="datetime-local"
                            value={editClockIn}
                            onChange={(e) => setEditClockIn(e.target.value)}
                            className="h-8 text-xs w-full [&::-webkit-calendar-picker-indicator]:hidden"
                          />
                        </Td>
                        <Td>
                          <Input
                            type="datetime-local"
                            value={editClockOut}
                            onChange={(e) => setEditClockOut(e.target.value)}
                            className="h-8 text-xs w-full [&::-webkit-calendar-picker-indicator]:hidden"
                          />
                        </Td>
                        <Td className="text-muted-foreground text-center">—</Td>
                        <Td className="text-center">
                          <HStack className="justify-center">
                            <fetcher.Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="updateEntry"
                              />
                              <input
                                type="hidden"
                                name="entryId"
                                value={entry.id}
                              />
                              <input
                                type="hidden"
                                name="clockIn"
                                value={
                                  isNaN(new Date(editClockIn).getTime())
                                    ? ""
                                    : new Date(editClockIn).toISOString()
                                }
                              />
                              {editClockOut &&
                                !isNaN(new Date(editClockOut).getTime()) && (
                                  <input
                                    type="hidden"
                                    name="clockOut"
                                    value={new Date(editClockOut).toISOString()}
                                  />
                                )}
                              <Button
                                variant="secondary"
                                type="submit"
                                disabled={isNaN(
                                  new Date(editClockIn).getTime()
                                )}
                              >
                                <Trans>Save</Trans>
                              </Button>
                            </fetcher.Form>
                            <Button
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              <Trans>Cancel</Trans>
                            </Button>
                          </HStack>
                        </Td>
                      </Tr>
                    ) : (
                      <Tr key={entry.id}>
                        <Td className="whitespace-nowrap">
                          {formatDay(entry.clockIn, locale)}
                        </Td>
                        <Td>{formatTime(entry.clockIn, locale)}</Td>
                        <Td>
                          {entry.clockOut ? (
                            formatTime(entry.clockOut, locale)
                          ) : (
                            <Badge variant="green">
                              <Trans>Active</Trans>
                            </Badge>
                          )}
                        </Td>
                        <Td className="text-center">
                          {formatDuration(entry.clockIn, entry.clockOut)}
                        </Td>
                        <Td className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton
                                aria-label={t`More options`}
                                variant="ghost"
                                icon={<LuEllipsisVertical />}
                              />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => startEdit(entry)}
                              >
                                <DropdownMenuIcon icon={<LuPencil />} />
                                <Trans>Edit</Trans>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setDeletingEntry({
                                    id: entry.id,
                                    clockIn: entry.clockIn
                                  })
                                }
                                className="text-destructive"
                              >
                                <DropdownMenuIcon icon={<LuTrash />} />
                                <Trans>Delete</Trans>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </Td>
                      </Tr>
                    )
                  )
                )}
              </Tbody>
            </TableBase>

            {entries.length > 0 && (
              <div className="mt-4 text-right text-sm font-medium">
                <Trans>Total: {formatTotalHours(entries)}</Trans>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {deletingEntry && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setDeletingEntry(null);
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>
                  Delete Timecard (
                  {new Date(deletingEntry.clockIn).toLocaleString(locale)})
                </Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Trans>
                Are you sure you want to delete this timecard? This cannot be
                undone.
              </Trans>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setDeletingEntry(null)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const formData = new FormData();
                  formData.append("intent", "deleteEntry");
                  formData.append("entryId", deletingEntry.id);
                  fetcher.submit(formData, { method: "post" });
                  setDeletingEntry(null);
                }}
              >
                <Trans>Delete</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </div>
  );
}
