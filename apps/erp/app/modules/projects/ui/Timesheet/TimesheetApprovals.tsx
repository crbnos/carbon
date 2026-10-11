// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Table as TableBase,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { weekStartOf } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCalendarDays, LuCheck, LuClipboardCheck, LuX } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { EmployeeAvatar } from "~/components";
import {
  useCompanyToday,
  useDateFormatter,
  useQuantityFormatter
} from "~/hooks";
import { path } from "~/utils/path";
import type { getTimesheetApprovals } from "../../projects.service";

type ApprovalGroup = NonNullable<
  Awaited<ReturnType<typeof getTimesheetApprovals>>["data"]
>[number];

/**
 * Submitted time, one card per employee and week. Approve posts the time;
 * Reject sends it back to the employee with a note.
 */
export default function TimesheetApprovals({
  groups
}: {
  groups: ApprovalGroup[];
}) {
  const [rejecting, setRejecting] = useState<{
    ids: string[];
    label: string;
  } | null>(null);

  return (
    <div className="flex w-full max-w-[80rem] flex-col gap-4 p-4 mx-auto">
      <h2 className="text-base font-medium">
        <Trans>Approvals</Trans>
      </h2>
      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <LuClipboardCheck className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <Trans>No time is waiting for approval.</Trans>
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <ApprovalCard
            key={group.key}
            group={group}
            onReject={(ids, label) => setRejecting({ ids, label })}
          />
        ))
      )}
      {rejecting && (
        <RejectModal
          ids={rejecting.ids}
          label={rejecting.label}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}

function ApprovalCard({
  group,
  onReject
}: {
  group: ApprovalGroup;
  onReject: (ids: string[], label: string) => void;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const fetcher = useFetcher();
  const isApproving = fetcher.state !== "idle";
  const today = useCompanyToday();

  const weekEnd = parseDate(group.weekStart).add({ days: 6 }).toString();
  // The employee page navigates by weeks from this week, as My Timesheet.
  const weekOffset =
    parseDate(group.weekStart).compare(parseDate(weekStartOf(today))) / 7;
  const weekLabel = `${formatDate(group.weekStart)} – ${formatDate(weekEnd)}`;
  const employeeName = group.employee?.fullName ?? "";
  const allIds = group.entries.map((entry) => entry.id);

  const approve = (ids: string[]) =>
    fetcher.submit(
      { intent: "approve", ids },
      { method: "post", action: path.to.projectTimesheetApprovals }
    );

  return (
    <Card>
      <HStack className="items-start justify-between">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <EmployeeAvatar employeeId={group.employeeId} size="xs" />
            </span>
          </CardTitle>
          <CardDescription>
            <span className="tabular-nums">
              {weekLabel} · {formatQuantity(group.totalHours)}{" "}
              <Trans>hours</Trans>
            </span>
          </CardDescription>
        </CardHeader>
        <CardAction>
          <HStack spacing={2}>
            <Button variant="ghost" leftIcon={<LuCalendarDays />} asChild>
              <Link
                to={`${path.to.employeeTimesheet(group.employeeId)}?week=${weekOffset}`}
              >
                <Trans>Open timesheet</Trans>
              </Link>
            </Button>
            <Button
              variant="secondary"
              leftIcon={<LuX />}
              isDisabled={isApproving}
              onClick={() => onReject(allIds, `${employeeName} · ${weekLabel}`)}
            >
              <Trans>Reject all</Trans>
            </Button>
            <Button
              leftIcon={<LuCheck />}
              isLoading={isApproving}
              isDisabled={isApproving}
              onClick={() => approve(allIds)}
            >
              <Trans>Approve all</Trans>
            </Button>
          </HStack>
        </CardAction>
      </HStack>
      <CardContent>
        <div className="w-full overflow-x-auto rounded-md border border-border">
          <TableBase full>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Date</Trans>
                </Th>
                <Th>
                  <Trans>Charge Number</Trans>
                </Th>
                <Th>
                  <Trans>Labor Category</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Hours</Trans>
                </Th>
                <Th>
                  <Trans>Note</Trans>
                </Th>
                <Th className="w-20">
                  <span className="sr-only">
                    <Trans>Actions</Trans>
                  </span>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {group.entries.map((entry) => {
                const readableId =
                  entry.element?.readableId ?? entry.project?.identifier ?? "";
                const name = entry.element?.name ?? entry.project?.name ?? "";
                // A labor transfer: a correction on another charge number.
                const original = entry.correctionOf;
                const isTransfer =
                  !!original &&
                  (original.projectId !== entry.projectId ||
                    original.projectElementId !== entry.projectElementId);
                const fromReadableId =
                  original?.element?.readableId ??
                  original?.project?.identifier ??
                  "";
                const label = `${employeeName} · ${readableId} · ${formatDate(entry.entryDate)}`;
                return (
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatDate(entry.entryDate)}
                    </Td>
                    <Td>
                      <div className="flex max-w-[22rem] flex-col">
                        <div className="flex min-w-0 items-center gap-2">
                          {isTransfer && (
                            <Badge variant="secondary" className="shrink-0">
                              <Trans>Transfer</Trans>
                            </Badge>
                          )}
                          <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                            {readableId}
                          </span>
                          <span className="truncate">{name}</span>
                        </div>
                        {isTransfer && (
                          <span className="truncate text-xs text-muted-foreground">
                            <Trans>
                              from{" "}
                              <span className="font-mono">
                                {fromReadableId}
                              </span>
                            </Trans>
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {entry.laborCategory?.name ?? "—"}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQuantity(Number(entry.hours))}
                    </Td>
                    <Td>
                      <span className="line-clamp-1 max-w-[16rem] text-muted-foreground">
                        {entry.correctionReason
                          ? t`Correction: ${entry.correctionReason}`
                          : (entry.note ?? "")}
                      </span>
                    </Td>
                    <Td>
                      <HStack spacing={1} className="justify-end">
                        <IconButton
                          aria-label={t`Approve`}
                          icon={<LuCheck />}
                          variant="ghost"
                          size="sm"
                          isDisabled={isApproving}
                          onClick={() => approve([entry.id])}
                        />
                        <IconButton
                          aria-label={t`Reject`}
                          icon={<LuX />}
                          variant="ghost"
                          size="sm"
                          isDisabled={isApproving}
                          onClick={() => onReject([entry.id], label)}
                        />
                      </HStack>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableBase>
        </div>
      </CardContent>
    </Card>
  );
}

function RejectModal({
  ids,
  label,
  onClose
}: {
  ids: string[];
  label: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<{ success: boolean }>({ onSuccess: onClose });
  const [note, setNote] = useState("");
  const isSubmitting = fetcher.state !== "idle";

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <fetcher.Form method="post" action={path.to.projectTimesheetApprovals}>
          <ModalHeader>
            <ModalTitle>
              <Trans>Reject Time</Trans>
            </ModalTitle>
            <ModalDescription>{label}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <input type="hidden" name="intent" value="reject" />
            {ids.map((id) => (
              <input key={id} type="hidden" name="ids" value={id} />
            ))}
            <Textarea
              name="note"
              aria-label={t`Note`}
              placeholder={t`Tell the employee what to fix`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="submit"
              variant="destructive"
              isDisabled={!note.trim() || isSubmitting}
              isLoading={isSubmitting}
            >
              <Trans>Reject</Trans>
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
}
