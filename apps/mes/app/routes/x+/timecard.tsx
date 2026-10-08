// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DateTimePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
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
  Tr,
  useViewport
} from "@carbon/react";
import { datetime, fromLocalDateTime, toLocalDateTime } from "@carbon/utils";
import type { CalendarDateTime } from "@internationalized/date";
import { toCalendarDateTime } from "@internationalized/date";
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
import { Link, useLoaderData } from "react-router";
import { DateTime } from "~/components";
import { MesAppBar } from "~/components/MesAppBar";
import { useMesBottomBar } from "~/components/MesBottomBar";
import {
  clockIn,
  clockOut,
  getOpenClockEntry,
  updateTimeCardEntry
} from "~/services/people.service";
import { path } from "~/utils/path";

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

function formatDay(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const weekOffset = parseInt(url.searchParams.get("week") ?? "0", 10);
  // Week runs Monday → Sunday on the company calendar (one payroll boundary
  // per books, not the server's zone).
  const tz = await getCompanyTimeZone(client, companyId);
  const { from, to } = datetime.weekBounds(tz, weekOffset);
  // Calendar days of the window on the COMPANY calendar — the client renders
  // these directly so the header never shifts a day in a different browser tz.
  const weekStart = datetime.businessDay(from, tz).toString();
  const weekEnd = datetime.businessDay(to, tz).toString();

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
    weekStart,
    weekEnd
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
  const bottomBarRef = useMesBottomBar();
  const { isPhone } = useViewport();
  const { entries, openEntry, weekOffset, weekStart, weekEnd } =
    useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSettled: (data) => {
      if (data) {
        setEditingId(null);
      }
    }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState<CalendarDateTime | null>(null);
  const [editClockOut, setEditClockOut] = useState<CalendarDateTime | null>(
    null
  );
  const [, setTick] = useState(0);
  const { t } = useLingui();
  const { locale } = useLocale();
  const [deletingEntry, setDeletingEntry] = useState<{
    id: string;
    clockIn: string;
  } | null>(null);

  const isCurrentWeek = weekOffset === 0;

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  function startEdit(entry: {
    id: string;
    clockIn: string;
    clockOut: string | null;
  }) {
    setEditingId(entry.id);
    setEditClockIn(toLocalDateTime(entry.clockIn));
    setEditClockOut(entry.clockOut ? toLocalDateTime(entry.clockOut) : null);
  }

  const renderClockForm = (size: "md" | "lg", className?: string) =>
    openEntry ? (
      <fetcher.Form method="post" className={className}>
        <input type="hidden" name="intent" value="clockOut" />
        <Button
          variant="destructive"
          type="submit"
          size={size}
          className={className}
          disabled={fetcher.state !== "idle"}
        >
          <Trans>Clock Out</Trans>
        </Button>
      </fetcher.Form>
    ) : (
      <fetcher.Form method="post" className={className}>
        <input type="hidden" name="intent" value="clockIn" />
        <Button
          leftIcon={<LuPlay />}
          type="submit"
          size={size}
          className={className}
          disabled={fetcher.state !== "idle"}
        >
          <Trans>Clock In</Trans>
        </Button>
      </fetcher.Form>
    );

  const renderSaveForm = (entryId: string) => (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="updateEntry" />
      <input type="hidden" name="entryId" value={entryId} />
      <input
        type="hidden"
        name="clockIn"
        value={editClockIn ? fromLocalDateTime(editClockIn) : ""}
      />
      {editClockOut && (
        <input
          type="hidden"
          name="clockOut"
          value={fromLocalDateTime(editClockOut)}
        />
      )}
      <Button
        isLoading={fetcher.state !== "idle"}
        variant="secondary"
        type="submit"
        disabled={!editClockIn}
      >
        <Trans>Save</Trans>
      </Button>
    </fetcher.Form>
  );

  const renderEntryMenu = (
    entry: { id: string; clockIn: string; clockOut: string | null },
    size: "md" | "lg"
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t`More options`}
          variant="ghost"
          size={size}
          icon={<LuEllipsisVertical />}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          shortcut={MENU_ITEM_SHORTCUTS.edit}
          onClick={() => startEdit(entry)}
        >
          <DropdownMenuIcon icon={<LuPencil />} />
          <Trans>Edit</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem
          shortcut={MENU_ITEM_SHORTCUTS.delete}
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
  );

  return (
    <>
      <MesAppBar title={<Trans>My Hours</Trans>} />
      <div className="flex flex-col h-full w-full overflow-y-auto p-4 md:p-6 max-md:h-auto max-md:overflow-visible max-md:pb-24">
        <div className="max-w-[60rem] mx-auto w-full">
          <Card className="overflow-hidden">
            <CardHeader className={cn(!openEntry && "max-md:hidden")}>
              <HStack className="justify-between items-center">
                <CardTitle className="max-md:hidden">
                  <Trans>My Hours</Trans>
                </CardTitle>
                {!isPhone && (
                  <HStack className="gap-1 max-md:hidden">
                    {renderClockForm("md")}
                  </HStack>
                )}
              </HStack>
              {openEntry && (
                <Badge variant="green" className="w-fit">
                  <Trans>
                    Clocked in since{" "}
                    <DateTime value={openEntry.clockIn} variant="time" />
                  </Trans>
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <HStack className="justify-between items-center mb-4">
                <Button
                  variant="outline"
                  asChild
                  leftIcon={<LuChevronLeft className="max-md:mr-0" />}
                  className="max-md:size-11 max-md:px-0"
                >
                  <Link to={`${path.to.timeCardPage}?week=${weekOffset - 1}`}>
                    <span className="max-md:sr-only">
                      <Trans>Prev</Trans>
                    </span>
                  </Link>
                </Button>
                <span className="text-sm text-muted-foreground max-md:whitespace-nowrap">
                  <DateTime
                    value={weekStart}
                    variant="date"
                    dateOptions={{ dateStyle: "medium" }}
                  />{" "}
                  —{" "}
                  <DateTime
                    value={weekEnd}
                    variant="date"
                    dateOptions={{ dateStyle: "medium" }}
                  />
                </span>
                <Button
                  variant="outline"
                  disabled={isCurrentWeek}
                  asChild={!isCurrentWeek}
                  rightIcon={<LuChevronRight className="max-md:ml-0" />}
                  className="max-md:size-11 max-md:px-0"
                >
                  {isCurrentWeek ? (
                    <span className="max-md:sr-only">
                      <Trans>Next</Trans>
                    </span>
                  ) : (
                    <Link to={`${path.to.timeCardPage}?week=${weekOffset + 1}`}>
                      <span className="max-md:sr-only">
                        <Trans>Next</Trans>
                      </span>
                    </Link>
                  )}
                </Button>
              </HStack>

              {/* One layout mounts: the edit row (its inputs and Save form)
                  must not exist twice. */}
              {isPhone ? (
                <>
                  {entries.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      <Trans>No time entries for this week</Trans>
                    </p>
                  ) : (
                    <ul className="-mx-4 divide-y divide-border border-y border-border">
                      {entries.map((entry) =>
                        editingId === entry.id ? (
                          <li
                            key={entry.id}
                            className="flex flex-col gap-2 px-4 py-3"
                          >
                            <span className="text-sm font-medium">
                              {formatDay(entry.clockIn, locale)}
                            </span>
                            <DateTimePicker
                              aria-label={t`Clock In`}
                              value={editClockIn}
                              onChange={(value) =>
                                setEditClockIn(
                                  value ? toCalendarDateTime(value) : null
                                )
                              }
                            />
                            <DateTimePicker
                              aria-label={t`Clock Out`}
                              value={editClockOut}
                              onChange={(value) =>
                                setEditClockOut(
                                  value ? toCalendarDateTime(value) : null
                                )
                              }
                            />
                            <HStack className="justify-end">
                              {renderSaveForm(entry.id)}
                              <Button
                                variant="ghost"
                                onClick={() => setEditingId(null)}
                              >
                                <Trans>Cancel</Trans>
                              </Button>
                            </HStack>
                          </li>
                        ) : (
                          <li
                            key={entry.id}
                            className="flex items-center gap-2 py-2 pl-4 pr-1"
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-medium">
                                  {formatDay(entry.clockIn, locale)}
                                </span>
                                <span className="text-sm tabular-nums">
                                  {formatDuration(
                                    entry.clockIn,
                                    entry.clockOut
                                  )}
                                </span>
                              </div>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <DateTime
                                  value={entry.clockIn}
                                  variant="time"
                                />
                                <span aria-hidden>–</span>
                                {entry.clockOut ? (
                                  <DateTime
                                    value={entry.clockOut}
                                    variant="time"
                                  />
                                ) : (
                                  <Badge variant="green">
                                    <Trans>Active</Trans>
                                  </Badge>
                                )}
                              </span>
                            </div>
                            {renderEntryMenu(entry, "lg")}
                          </li>
                        )
                      )}
                    </ul>
                  )}
                </>
              ) : (
                <div>
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
                                <DateTimePicker
                                  aria-label={t`Clock In`}
                                  size="sm"
                                  value={editClockIn}
                                  onChange={(value) =>
                                    setEditClockIn(
                                      value ? toCalendarDateTime(value) : null
                                    )
                                  }
                                />
                              </Td>
                              <Td>
                                <DateTimePicker
                                  aria-label={t`Clock Out`}
                                  size="sm"
                                  value={editClockOut}
                                  onChange={(value) =>
                                    setEditClockOut(
                                      value ? toCalendarDateTime(value) : null
                                    )
                                  }
                                />
                              </Td>
                              <Td className="text-muted-foreground text-center">
                                —
                              </Td>
                              <Td className="text-center">
                                <HStack className="justify-center">
                                  {renderSaveForm(entry.id)}
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
                              <Td>
                                <DateTime
                                  value={entry.clockIn}
                                  variant="time"
                                />
                              </Td>
                              <Td>
                                {entry.clockOut ? (
                                  <DateTime
                                    value={entry.clockOut}
                                    variant="time"
                                  />
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
                                {renderEntryMenu(entry, "md")}
                              </Td>
                            </Tr>
                          )
                        )
                      )}
                    </Tbody>
                  </TableBase>
                </div>
              )}

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
                    <DateTime
                      value={deletingEntry.clockIn}
                      variant="absolute"
                    />
                    )
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
      {isPhone && (
        <div
          ref={bottomBarRef}
          data-mes-bottom-bar
          className="fixed inset-x-0 bottom-[var(--mes-tab-bar-h)] z-20 border-t border-border bg-card px-4 py-3 md:hidden"
        >
          {renderClockForm("lg", "w-full h-12")}
        </div>
      )}
    </>
  );
}
