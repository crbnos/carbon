// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import {
  Badge,
  Button,
  Combobox,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  IconButton,
  Kbd,
  useShortcutKeys,
  VStack
} from "@carbon/react";
import { formatDateTimeInZone } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuChevronUp,
  LuLoaderCircle
} from "react-icons/lu";
import { useFetcher, useNavigate, useSearchParams } from "react-router";
import { FieldEmptyState } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { MACHINE_TIME_REVIEW_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import type { getUnattributedMachineTime } from "../../production.service";
import {
  MachineTimeInstant,
  useMachineTimeDuration
} from "./MachineTimeTable.ee";
import type { MachineTimeSuggestion } from "./machine-time-suggestions.ee";

type JobOperationStatus = Database["public"]["Enums"]["jobOperationStatus"];

type MachineTime = NonNullable<
  Awaited<ReturnType<typeof getUnattributedMachineTime>>["data"]
>;

type MachineTimeDrawerProps = {
  machineTime: MachineTime;
  timeZone: string;
  queue: {
    /** Null for a running row: the queue holds stopped rows only. */
    position: number | null;
    total: number;
    previousId: string | null;
    nextId: string | null;
  };
  suggestions: MachineTimeSuggestion[];
  operationOptions: {
    value: string;
    label: string;
    workCenterName: string | null;
    status: JobOperationStatus | null;
  }[];
  /** The reads that failed: the drawer says so instead of showing them empty. */
  loadErrors: { queue: boolean; suggestions: boolean; operations: boolean };
  onClose: () => void;
};

const MachineTimeDrawer = ({
  machineTime,
  timeZone,
  queue,
  suggestions,
  operationOptions,
  loadErrors,
  onClose
}: MachineTimeDrawerProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const permissions = usePermissions();
  const duration = useMachineTimeDuration();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher();

  const isRunning = !machineTime.endTime;
  const isBusy = fetcher.state !== "idle";
  const canAnswer = permissions.can("update", "production") && !isRunning;
  const pendingOperationId = fetcher.formData?.get("jobOperationId");
  const isDismissing = fetcher.formData?.get("intent") === "dismiss";
  const workCenterName =
    machineTime.workCenter?.name ?? machineTime.workCenterId;

  // A queue move replaces the entry, so Back leaves the review instead of
  // walking back through every row.
  const goTo = (id: string | null) => {
    if (!id) return;
    navigate(`${path.to.unattributedMachineTime(id)}?${searchParams}`, {
      replace: true
    });
  };

  const statusLabels: Record<JobOperationStatus, string> = {
    Todo: t`Todo`,
    Ready: t`Ready`,
    Waiting: t`Waiting`,
    "In Progress": t`In Progress`,
    Paused: t`Paused`,
    Done: t`Done`,
    Canceled: t`Canceled`
  };
  const searchOptions = operationOptions.map(
    ({ workCenterName, status, ...option }) => ({
      ...option,
      helper: workCenterName ?? (status ? statusLabels[status] : undefined)
    })
  );

  const position = queue.position;
  const total = queue.total;

  // One answer per row: a held key, or a second click before the fetcher
  // re-renders as busy, must not post twice.
  const answered = useRef(false);
  // A failed answer leaves the drawer on this row; let it be answered again.
  useEffect(() => {
    if (fetcher.state === "idle") answered.current = false;
  }, [fetcher.state]);
  const answer = (submission: Record<string, string>) => {
    if (!canAnswer || isBusy || answered.current) return;
    answered.current = true;
    fetcher.submit(submission, { method: "post" });
  };
  const assign = (jobOperationId: string) =>
    answer({ intent: "assign", jobOperationId });
  const dismiss = () => answer({ intent: "dismiss" });

  const assignable = suggestions.filter((s) => s.blockedBy === null);

  useShortcutKeys({
    shortcut: [...MACHINE_TIME_REVIEW_SHORTCUTS.choose],
    action: (event) => {
      if (event.repeat) return;
      const suggestion = assignable[Number(event.key) - 1];
      if (suggestion) assign(suggestion.jobOperationId);
    },
    disabled: !canAnswer || isBusy
  });
  useShortcutKeys({
    shortcut: MACHINE_TIME_REVIEW_SHORTCUTS.next,
    action: (event) => {
      if (!event.repeat) goTo(queue.nextId);
    },
    disabled: isBusy || !queue.nextId
  });
  useShortcutKeys({
    shortcut: MACHINE_TIME_REVIEW_SHORTCUTS.previous,
    action: (event) => {
      if (!event.repeat) goTo(queue.previousId);
    },
    disabled: isBusy || !queue.previousId
  });

  const time = (value: string) =>
    formatDateTimeInZone(value, timeZone, locale, {
      dateStyle: undefined,
      timeStyle: "short"
    });

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* No autofocus: it would ring the Previous button on every row. */}
      <DrawerContent onOpenAutoFocus={(event) => event.preventDefault()}>
        <DrawerHeader className="flex-row items-center justify-between gap-4 pr-14">
          <div className="flex min-w-0 flex-col gap-1">
            <DrawerTitle>{workCenterName}</DrawerTitle>
            <DrawerDescription>
              <Trans>Unattributed Time</Trans>
            </DrawerDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">
              {loadErrors.queue ? null : position === null ? (
                <Trans>Running</Trans>
              ) : (
                <Trans>
                  {position} of {total}
                </Trans>
              )}
            </span>
            <IconButton
              aria-label={t`Previous`}
              icon={<LuChevronUp />}
              variant="ghost"
              isDisabled={!queue.previousId || isBusy}
              onClick={() => goTo(queue.previousId)}
            />
            <IconButton
              aria-label={t`Next`}
              icon={<LuChevronDown />}
              variant="ghost"
              isDisabled={!queue.nextId || isBusy}
              onClick={() => goTo(queue.nextId)}
            />
          </div>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            <div className="w-full divide-y divide-border border-y border-border">
              <DetailRow label={t`Start`}>
                <MachineTimeInstant
                  value={machineTime.startTime}
                  timeZone={timeZone}
                />
              </DetailRow>
              <DetailRow label={t`End`}>
                {machineTime.endTime ? (
                  <MachineTimeInstant
                    value={machineTime.endTime}
                    timeZone={timeZone}
                  />
                ) : (
                  <Trans>Running</Trans>
                )}
              </DetailRow>
              <DetailRow label={t`Duration`}>
                {duration.between(
                  machineTime.startTime,
                  machineTime.endTime
                ) ?? <Trans>Running</Trans>}
              </DetailRow>
            </div>

            <div className="flex w-full flex-col gap-2">
              <h3 className="text-sm font-medium">
                <Trans>Which operation was this?</Trans>
              </h3>
              {isRunning && (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    The machine is still running. Assign this time after it
                    stops.
                  </Trans>
                </p>
              )}

              {loadErrors.suggestions ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>Could not load what ran on {workCenterName}.</Trans>
                </p>
              ) : suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>Nothing else ran on {workCenterName} that day.</Trans>
                </p>
              ) : (
                suggestions.map((suggestion) => {
                  const shortcutIndex = assignable.indexOf(suggestion);
                  const isPending =
                    pendingOperationId === suggestion.jobOperationId;
                  const isDisabled =
                    !canAnswer || isBusy || suggestion.blockedBy !== null;
                  return (
                    <button
                      key={suggestion.jobOperationId}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => assign(suggestion.jobOperationId)}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors",
                        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        "disabled:cursor-not-allowed",
                        suggestion.blockedBy !== null && "opacity-60"
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                          <span className="shrink-0 whitespace-nowrap font-medium">
                            {suggestion.jobReadableId}
                          </span>
                          <span className="truncate">
                            {suggestion.description}
                          </span>
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          {[
                            `${time(suggestion.firstStart)} – ${
                              suggestion.lastEnd
                                ? time(suggestion.lastEnd)
                                : t`now`
                            }`,
                            duration.length(suggestion.totalMs),
                            suggestion.itemReadableId
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      {suggestion.blockedBy !== null ? (
                        <Badge variant="gray" className="shrink-0">
                          {suggestion.blockedBy === "Locked"
                            ? t`Job locked`
                            : suggestion.blockedBy === "Done"
                              ? t`Done`
                              : t`Canceled`}
                        </Badge>
                      ) : suggestion.overlaps ? (
                        <Badge variant="green" className="shrink-0">
                          <Trans>Ran at the time</Trans>
                        </Badge>
                      ) : null}
                      {isPending ? (
                        <LuLoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : suggestion.blockedBy !== null ? null : shortcutIndex <
                        MACHINE_TIME_REVIEW_SHORTCUTS.choose.length ? (
                        <Kbd className="shrink-0">{shortcutIndex + 1}</Kbd>
                      ) : (
                        <LuChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })
              )}

              <div className="flex w-full flex-col gap-2 rounded-lg border border-dashed border-border p-3">
                <span className="text-xs text-muted-foreground">
                  <Trans>Another job or operation</Trans>
                </span>
                <Combobox
                  size="sm"
                  value=""
                  options={searchOptions}
                  placeholder={t`Search jobs and operations`}
                  emptyMessage={
                    loadErrors.operations ? (
                      <FieldEmptyState
                        title={t`Could not load operations`}
                        description={t`Reload the page to try again.`}
                      />
                    ) : (
                      <FieldEmptyState
                        title={t`No open operations`}
                        description={t`No job at this location has an open operation.`}
                      />
                    )
                  }
                  isReadOnly={!canAnswer || isBusy}
                  onChange={(jobOperationId) => {
                    if (jobOperationId) assign(jobOperationId);
                  }}
                />
              </div>
            </div>
          </VStack>
        </DrawerBody>
        <DrawerFooter>
          <Button
            variant="secondary"
            isDisabled={!canAnswer || isBusy}
            isLoading={isDismissing}
            onClick={dismiss}
          >
            <Trans>Not job time</Trans>
          </Button>
          <Button
            variant="secondary"
            isDisabled={!queue.nextId || isBusy}
            rightIcon={<LuChevronDown />}
            onClick={() => goTo(queue.nextId)}
          >
            <Trans>Skip</Trans>
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

// Same row as the fixed asset page's DetailRow: label left, value right.
function DetailRow({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-base sm:text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">
        {children}
      </span>
    </div>
  );
}

export default MachineTimeDrawer;
