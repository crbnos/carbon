// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr
} from "@carbon/react";
import { serverFns } from "@carbon/server-functions";
import { formatDate, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuCheck,
  LuInfo,
  LuLock,
  LuLockOpen,
  LuPlay,
  LuSkipForward,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Link,
  useFetcher,
  useLoaderData,
  useNavigate
} from "react-router";
import { EmployeeAvatar } from "~/components";
import { useCurrencyFormatter } from "~/hooks";
import type {
  PeriodCloseStatus,
  PeriodCloseTaskView
} from "~/modules/accounting";
import {
  closePeriodWithChecklist,
  closeTaskCompleteValidator,
  closeTaskSkipValidator,
  completeCloseTask,
  createDepreciationRun,
  getAccountingPeriods,
  getPeriodCloseChecklist,
  LOCK_PERIOD_TASK_NAME,
  lockAccountingPeriod,
  skipCloseTask,
  unlockAccountingPeriod
} from "~/modules/accounting";
import { futureRunPeriodError } from "~/modules/accounting/accounting.server";
import { PeriodCloseUnpostedDocumentsPopover } from "~/modules/accounting/ui/Periods";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Close Period`,
  to: path.to.accountingPeriods
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      view: "accounting",
      role: "employee"
    });

  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");

  const [checklist, periods] = await Promise.all([
    getPeriodCloseChecklist(client, getDatabaseClient(), {
      companyId,
      companyGroupId,
      userId,
      periodId
    }),
    getAccountingPeriods(client, companyId)
  ]);

  if (checklist.error || !checklist.data) {
    throw redirect(
      path.to.accountingPeriods,
      await flash(
        request,
        error(checklist.error, "Failed to load the close checklist")
      )
    );
  }

  const period = (periods.data ?? []).find((p) => p.id === periodId) ?? null;

  return { checklist: checklist.data, period };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "accounting"
    });

  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "completeTask") {
    const validation = await validator(closeTaskCompleteValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);

    const result = await completeCloseTask(client, {
      taskId: validation.data.taskId,
      notes: validation.data.notes,
      companyId,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to complete task"))
      );
    }
    return data({}, await flash(request, success("Task marked done")));
  }

  if (intent === "skipTask") {
    const validation = await validator(closeTaskSkipValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);

    const result = await skipCloseTask(client, {
      taskId: validation.data.taskId,
      skippedReason: validation.data.skippedReason,
      companyId,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to skip task"))
      );
    }
    return data({}, await flash(request, success("Task skipped")));
  }

  if (intent === "lock") {
    const result = await lockAccountingPeriod(client, {
      periodId,
      companyId,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to lock period"))
      );
    }
    return data({}, await flash(request, success("Period locked")));
  }

  if (intent === "unlock") {
    const result = await unlockAccountingPeriod(client, {
      periodId,
      companyId,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to unlock period"))
      );
    }
    return data({}, await flash(request, success("Period unlocked")));
  }

  if (intent === "create-revenue-run" || intent === "create-depreciation-run") {
    await requirePermissions(request, { create: "accounting" });
    const period = await client
      .from("accountingPeriod")
      .select("endDate")
      .eq("id", periodId)
      .eq("companyId", companyId)
      .single();
    if (period.error) {
      return data(
        {},
        await flash(request, error(period.error, "Failed to load the period"))
      );
    }
    const periodEnd = period.data.endDate;
    const futureError = await futureRunPeriodError(
      client,
      companyId,
      periodEnd
    );
    if (futureError) {
      return data({}, await flash(request, error(null, futureError)));
    }

    if (intent === "create-revenue-run") {
      // One Draft per period: send the user to it rather than make another.
      const existingDraft = await client
        .from("revenueRecognitionRun")
        .select("id, runId")
        .eq("periodEnd", periodEnd)
        .eq("companyId", companyId)
        .eq("status", "Draft")
        .maybeSingle();
      if (existingDraft.data) {
        throw redirect(
          path.to.revenueRecognitionRun(existingDraft.data.id),
          await flash(
            request,
            error(
              null,
              `${existingDraft.data.runId} is already a draft for this period. Recalculate it instead.`
            )
          )
        );
      }

      let proposal: { id: string } | null;
      try {
        // The proposal creates nothing when nothing is due.
        proposal = await serverFns
          .system({ db: getDatabaseClient(), companyId, userId })
          .invokeOrThrow("propose-revenue-recognition-run", { periodEnd });
      } catch (e) {
        return data(
          {},
          await flash(
            request,
            error(e, "Failed to create revenue recognition run")
          )
        );
      }
      if (!proposal) {
        return data(
          {},
          await flash(
            request,
            error(null, "Nothing to recognize for this period")
          )
        );
      }
      throw redirect(
        path.to.revenueRecognitionRun(proposal.id),
        await flash(request, success("Revenue recognition run created"))
      );
    }

    const existingDraft = await client
      .from("depreciationRun")
      .select("id, depreciationRunId")
      .eq("periodEnd", periodEnd)
      .eq("companyId", companyId)
      .eq("status", "Draft")
      .limit(1)
      .maybeSingle();
    if (existingDraft.data) {
      throw redirect(
        path.to.depreciationRun(existingDraft.data.id),
        await flash(
          request,
          error(
            null,
            `${existingDraft.data.depreciationRunId} is already a draft for this period. Recalculate it instead.`
          )
        )
      );
    }

    // Never an empty run: with nothing to depreciate this refuses.
    const result = await createDepreciationRun(client, {
      companyId,
      companyGroupId,
      periodEnd,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, result.error.message))
      );
    }
    throw redirect(
      path.to.depreciationRun(result.data.id),
      await flash(request, success("Depreciation run created"))
    );
  }

  if (intent === "close") {
    const result = await closePeriodWithChecklist(client, getDatabaseClient(), {
      companyId,
      companyGroupId,
      periodId,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(
          request,
          error(result.error, result.error.message ?? "Failed to close period")
        )
      );
    }
    throw redirect(
      path.to.accountingPeriods,
      await flash(request, success("Period closed"))
    );
  }

  throw redirect(path.to.accountingPeriodClose(periodId));
}

const SEVERITY_COLOR = {
  Blocker: "red",
  Warning: "yellow"
} as const;

const STATUS_COLOR = {
  Open: "gray",
  Done: "green",
  Skipped: "blue"
} as const;

export default function AccountingPeriodCloseRoute() {
  const { checklist, period } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const closeFetcher = useFetcher<typeof action>();

  const periodLabel =
    period && period.fiscalYear && period.periodNumber
      ? `FY${period.fiscalYear} · Period ${period.periodNumber}`
      : period
        ? formatDate(period.startDate)
        : "Period";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.accountingPeriods);
      }}
    >
      <ModalContent size="xxlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Close {periodLabel}</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Every required task must be Done or Skipped before the period can
              be closed.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {checklist.blockingReason && (
            <Alert variant="destructive" className="mb-4">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Cannot close yet</Trans>
              </AlertTitle>
              <AlertDescription>{checklist.blockingReason}</AlertDescription>
            </Alert>
          )}
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Task</Trans>
                </Th>
                <Th>
                  <Trans>Type</Trans>
                </Th>
                <Th>
                  <Trans>Severity</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Actions</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {checklist.tasks.map((task) => (
                <PeriodCloseTaskRow
                  key={task.id}
                  task={task}
                  closeStatus={period?.closeStatus}
                />
              ))}
            </Tbody>
          </Table>
        </ModalBody>
        <ModalFooter>
          <closeFetcher.Form method="post">
            <input type="hidden" name="intent" value="close" />
            <Button
              type="submit"
              leftIcon={<LuLock />}
              isDisabled={!checklist.canClose}
              isLoading={closeFetcher.state !== "idle"}
            >
              <Trans>Close Period</Trans>
            </Button>
          </closeFetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function PeriodCloseTaskRow({
  task,
  closeStatus
}: {
  task: PeriodCloseTaskView;
  closeStatus?: PeriodCloseStatus;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof action>();
  const [skipping, setSkipping] = useState(false);
  const isBusy = fetcher.state !== "idle";

  const description = ((): string | null => {
    switch (task.autoCheckKey) {
      case "pending-postings":
        return t`Receipts, shipments, sales invoices, purchase invoices, payments, and credit/debit memos that are still Draft or Pending must be posted or voided — both documents dated in this period and undated documents that would receive a date in it when posted. Until they post, their amounts aren't in the general ledger, so the period would be understated.`;
      case "draft-journals":
        return t`Journal entries dated in this period that are still Draft must be posted, or re-dated into a later open period. Draft entries aren't part of the ledger, so their debits and credits would be missing from the close.`;
      case "draft-depreciation":
        return t`Asks depreciation what a new run for this period would depreciate now, and checks for Draft runs ending in the period. Create the run and post it so the period has its depreciation expense and accumulated depreciation. Skip with a reason if depreciation doesn't apply this period.`;
      case "unmatched-ic":
        return t`Intercompany transactions involving this company that are still Unmatched should be matched and eliminated, so consolidated results don't double-count activity between entities.`;
      case "unposted-revenue-schedules":
        return t`Asks revenue recognition what a new run for this period would recognize now — deferred invoice revenue, rent to accrue, and contract revenue — and checks for Draft runs holding revenue due by the period end. Create the run and post it so the revenue reaches the ledger. Skip with a reason if nothing should be recognized.`;
      case "tb-balanced":
        return t`Confirms every posted journal entry in the period has equal debits and credits. If any entry is out of balance the trial balance won't tie out, so it must be corrected before the period can close.`;
    }
    switch (task.name) {
      case "Lock the period":
        return t`Locking makes the period read-only for operational documents (receipts, shipments, invoices) while still allowing accounting adjustments like depreciation and disposals. A period must be locked before it can be closed.`;
      case "Review negative on-hand inventory":
        return t`Check the item ledger for any items with a negative on-hand quantity as of period end — usually a missing receipt or an out-of-order posting that distorts inventory value and cost of goods sold. Mark it done once reviewed, or skip with a reason.`;
      case "Review financial statements":
        return t`Review the period's balance sheet and income statement and confirm the figures look right. This is a manual sign-off — mark it done once you have reviewed them.`;
    }
    return null;
  })();

  const status = task.effectiveStatus;
  const isResolved = status === "Done" || status === "Skipped";
  // The "Lock the period" step is an Action whose button performs the real
  // Open <-> Locked transition (below), not a generic "Mark Done"/"Skip".
  const isLockTask =
    task.taskType === "Action" && task.name === LOCK_PERIOD_TASK_NAME;
  // Auto tasks are evaluated by the system; only Action/Manual tasks are
  // completed by hand. Blocker tasks can never be skipped (server enforces it),
  // so they get no Skip button.
  const canComplete =
    !isLockTask && task.taskType !== "Auto" && status === "Open";
  const canSkip =
    !isLockTask && task.severity !== "Blocker" && status === "Open";
  // The two run checks offer to create the run that would clear them.
  const createRunIntent =
    task.autoCheckKey === "unposted-revenue-schedules"
      ? "create-revenue-run"
      : task.autoCheckKey === "draft-depreciation"
        ? "create-depreciation-run"
        : null;
  const due = task.autoCheck?.due;
  const canCreateRun =
    createRunIntent !== null &&
    status === "Open" &&
    (due?.count ?? 0) > 0 &&
    (task.autoCheck?.draftRuns ?? []).length === 0;

  return (
    <>
      <Tr>
        <Td className="font-medium">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span>{task.name}</span>
              {description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t`What this task means`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <LuInfo className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>{description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {task.autoCheck?.documents &&
              task.autoCheck.documents.length > 0 && (
                <PeriodCloseUnpostedDocumentsPopover
                  documents={task.autoCheck.documents}
                  count={task.autoCheck.count}
                  title={
                    task.autoCheckKey === "draft-journals" ? (
                      <Trans>Draft Journal Entries</Trans>
                    ) : (
                      <Trans>Unposted Documents</Trans>
                    )
                  }
                  description={
                    task.autoCheckKey === "draft-journals" ? (
                      <Trans>
                        These journal entries are still Draft, so their debits
                        and credits aren't in the ledger for this period. Post
                        each one, or re-date it into a later open period.
                      </Trans>
                    ) : (
                      <Trans>
                        These documents haven't posted to the general ledger, so
                        their amounts are missing from this period. Post or void
                        each one — an undated document receives the posting
                        day's date when it posts.
                      </Trans>
                    )
                  }
                >
                  <button
                    type="button"
                    className="w-fit text-xs font-normal text-primary hover:underline"
                  >
                    {task.autoCheckKey === "draft-journals" ? (
                      task.autoCheck.count === 1 ? (
                        <Trans>1 draft journal entry</Trans>
                      ) : (
                        <Trans>
                          {task.autoCheck.count} draft journal entries
                        </Trans>
                      )
                    ) : task.autoCheck.count === 1 ? (
                      <Trans>1 unposted document</Trans>
                    ) : (
                      <Trans>{task.autoCheck.count} unposted documents</Trans>
                    )}
                  </button>
                </PeriodCloseUnpostedDocumentsPopover>
              )}
            {status === "Open" && task.autoCheck?.failing && (
              <>
                {createRunIntent && due && (
                  <PeriodRunDue
                    due={due}
                    draftRuns={task.autoCheck.draftRuns ?? []}
                    runType={
                      task.autoCheckKey === "draft-depreciation"
                        ? "depreciation"
                        : "revenue"
                    }
                  />
                )}
                {task.autoCheckKey === "draft-depreciation" && (
                  <Link
                    to={path.to.depreciationRuns}
                    className="w-fit text-xs font-normal text-primary hover:underline"
                  >
                    <Trans>Go to depreciation runs</Trans>
                  </Link>
                )}
                {task.autoCheckKey === "unposted-revenue-schedules" && (
                  <Link
                    to={path.to.revenueRecognitionRuns}
                    className="w-fit text-xs font-normal text-primary hover:underline"
                  >
                    <Trans>Go to revenue recognition runs</Trans>
                  </Link>
                )}
              </>
            )}
          </div>
        </Td>
        <Td>{task.taskType}</Td>
        <Td>
          {task.severity ? (
            <Status color={SEVERITY_COLOR[task.severity]}>
              {task.severity}
            </Status>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Td>
        <Td>
          <Status color={STATUS_COLOR[status]}>{status}</Status>
        </Td>
        <Td className="text-right">
          <div className="flex justify-end gap-2">
            {isLockTask && closeStatus === "Open" && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="lock" />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  leftIcon={<LuLock />}
                  isLoading={isBusy}
                >
                  <Trans>Lock Period</Trans>
                </Button>
              </fetcher.Form>
            )}
            {isLockTask && closeStatus === "Locked" && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="unlock" />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  leftIcon={<LuLockOpen />}
                  isLoading={isBusy}
                >
                  <Trans>Unlock</Trans>
                </Button>
              </fetcher.Form>
            )}
            {canCreateRun && createRunIntent && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value={createRunIntent} />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  leftIcon={<LuPlay />}
                  isLoading={isBusy}
                >
                  <Trans>Create Run</Trans>
                </Button>
              </fetcher.Form>
            )}
            {canComplete && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="completeTask" />
                <input type="hidden" name="taskId" value={task.id} />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  leftIcon={<LuCheck />}
                  isLoading={isBusy}
                >
                  <Trans>Mark Done</Trans>
                </Button>
              </fetcher.Form>
            )}
            {canSkip && !skipping && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<LuSkipForward />}
                onClick={() => setSkipping(true)}
              >
                <Trans>Skip</Trans>
              </Button>
            )}
            {isResolved && task.completedBy && (
              <EmployeeAvatar
                employeeId={task.completedBy}
                size="xs"
                withName={false}
              />
            )}
          </div>
        </Td>
      </Tr>
      {canSkip && skipping && (
        <Tr>
          <Td colSpan={5}>
            <fetcher.Form
              method="post"
              className="flex items-center gap-2"
              onSubmit={() => setSkipping(false)}
            >
              <input type="hidden" name="intent" value="skipTask" />
              <input type="hidden" name="taskId" value={task.id} />
              <Input
                name="skippedReason"
                placeholder={t`Reason for skipping (required)`}
                className="flex-1"
              />
              <Button
                type="submit"
                size="sm"
                leftIcon={<LuSkipForward />}
                isLoading={isBusy}
              >
                <Trans>Confirm Skip</Trans>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leftIcon={<LuX />}
                onClick={() => setSkipping(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
            </fetcher.Form>
          </Td>
        </Tr>
      )}
    </>
  );
}

/** What a run check is waiting on: what a new run would hold, and the
 *  Draft runs to post. */
function PeriodRunDue({
  due,
  draftRuns,
  runType
}: {
  due: { count: number; amount: number; error: string | null };
  draftRuns: { id: string; readableId: string }[];
  runType: "revenue" | "depreciation";
}) {
  const { t } = useLingui();
  const currencyFormatter = useCurrencyFormatter();
  const amount = currencyFormatter.format(due.amount);

  return (
    <div className="flex flex-col gap-0.5 text-xs font-normal">
      {due.error && <span className="text-destructive">{due.error}</span>}
      {due.count > 0 && (
        <span className="text-muted-foreground">
          {runType === "depreciation"
            ? due.count === 1
              ? t`1 asset to depreciate · ${amount}`
              : t`${due.count} assets to depreciate · ${amount}`
            : due.count === 1
              ? t`1 entry to recognize · ${amount}`
              : t`${due.count} entries to recognize · ${amount}`}
        </span>
      )}
      {draftRuns.map((run) => (
        <Link
          key={run.id}
          to={
            runType === "depreciation"
              ? path.to.depreciationRun(run.id)
              : path.to.revenueRecognitionRun(run.id)
          }
          className="w-fit text-primary hover:underline"
        >
          <Trans>Post draft run {run.readableId}</Trans>
        </Link>
      ))}
    </div>
  );
}
