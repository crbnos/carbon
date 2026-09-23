import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsisVertical, LuRepeat, LuTrash } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { DateTime } from "~/components";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  getRevenueRecognitionRun,
  getRevenueRecognitionRunLines,
  revenueScheduleTypes
} from "~/modules/accounting";
import { getNextPeriodEnd } from "~/modules/accounting/accounting.utils";
import { RevenueRecognitionRunStatus } from "~/modules/accounting/ui/RevenueRecognition";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    {
      breadcrumb: msg`Revenue Recognition`,
      to: path.to.revenueRecognitionRuns
    },
    (data) => data?.run?.runId
  ),
  module: "accounting"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { runId } = params;
  if (!runId) throw new Error("Could not find runId");

  const [run, lines] = await Promise.all([
    getRevenueRecognitionRun(client, runId),
    getRevenueRecognitionRunLines(client, runId)
  ]);

  if (run.error) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(
        request,
        error(run.error, "Failed to load revenue recognition run")
      )
    );
  }

  // Name the invoice behind each Deferral row (one lookup for the whole run).
  const invoiceLineIds = [
    ...new Set(
      (lines.data ?? [])
        .map((line) => line.schedule?.salesInvoiceLineId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const sources: Record<string, { label: string; to: string }> = {};
  if (invoiceLineIds.length > 0) {
    const invoiceLines = await client
      .from("salesInvoiceLine")
      .select("id, salesInvoice(id, invoiceId)")
      .in("id", invoiceLineIds);
    for (const row of invoiceLines.data ?? []) {
      if (row.salesInvoice) {
        sources[row.id] = {
          label: row.salesInvoice.invoiceId,
          to: path.to.salesInvoice(row.salesInvoice.id)
        };
      }
    }
  }

  return {
    run: run.data,
    lines: lines.data ?? [],
    sources,
    nextPeriodEnd: getNextPeriodEnd(run.data.periodEnd)
  };
}

type RevenueScheduleType = (typeof revenueScheduleTypes)[number];

const gridCols = "grid-cols-[auto_1fr_140px_1fr_140px]";

export default function RevenueRecognitionRunDetailRoute() {
  const { runId } = useParams();
  const { run, lines, sources, nextPeriodEnd } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const deleteModal = useDisclosure();
  const repeatModal = useDisclosure();

  if (!runId) throw new Error("Could not find runId");

  const isDraft = run.status === "Draft";
  const isPosted = run.status === "Posted";

  const sectionLabels: Record<RevenueScheduleType, string> = {
    Deferral: t`Deferrals`,
    Accrual: t`Accruals`,
    Interest: t`Interest`
  };

  const sections = revenueScheduleTypes
    .map((type) => ({
      type,
      lines: lines.filter((line) => line.schedule?.type === type)
    }))
    .filter((section) => section.lines.length > 0);

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 pb-16 w-full max-w-5xl mx-auto">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <HStack>
              <Heading as="h1" size="h3">
                {run.runId}
              </Heading>
              <Copy text={run.runId} />
              {(isDraft || isPosted) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`More options`}
                      icon={<LuEllipsisVertical />}
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {isPosted && (
                      <DropdownMenuItem
                        disabled={!permissions.can("create", "accounting")}
                        onClick={repeatModal.onOpen}
                      >
                        <DropdownMenuIcon icon={<LuRepeat />} />
                        <Trans>Repeat Run</Trans>
                      </DropdownMenuItem>
                    )}
                    {isDraft && (
                      <DropdownMenuItem
                        disabled={!permissions.can("delete", "accounting")}
                        destructive
                        onClick={deleteModal.onOpen}
                      >
                        <DropdownMenuIcon icon={<LuTrash />} />
                        <Trans>Delete</Trans>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <RevenueRecognitionRunStatus status={run.status} />
            </HStack>
            <HStack>
              {isDraft && permissions.can("update", "accounting") && (
                <fetcher.Form method="post" action="post">
                  <Button
                    variant="primary"
                    type="submit"
                    isLoading={fetcher.state !== "idle"}
                  >
                    <Trans>Post Run</Trans>
                  </Button>
                </fetcher.Form>
              )}
            </HStack>
          </CardHeader>

          <CardContent>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-3 w-full mb-6">
              <div>
                <p className="text-sm text-muted-foreground">
                  <Trans>Period End</Trans>
                </p>
                <p className="text-sm">
                  <DateTime value={run.periodEnd} variant="date" />
                </p>
              </div>
              {run.postedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    <Trans>Posted At</Trans>
                  </p>
                  <p className="text-sm">
                    <DateTime value={run.postedAt} variant="date" />
                  </p>
                </div>
              )}
              {run.journalId && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    <Trans>Journal</Trans>
                  </p>
                  <p className="text-sm">
                    <Link
                      to={path.to.journalEntry(run.journalId)}
                      className="text-foreground hover:underline"
                    >
                      <Trans>View journal entry</Trans>
                    </Link>
                  </p>
                </div>
              )}
            </div>

            {sections.length === 0 ? (
              <div className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground text-center w-full">
                <Trans>No revenue to recognize for this period.</Trans>
              </div>
            ) : (
              <div className="flex flex-col gap-6 w-full">
                {sections.map((section) => {
                  const sectionTotal = section.lines.reduce(
                    (sum, line) => sum + Number(line.amount),
                    0
                  );
                  const lineCount = section.lines.length;
                  return (
                    <div key={section.type} className="w-full">
                      <Heading as="h2" size="h4" className="mb-2">
                        {sectionLabels[section.type]}
                      </Heading>
                      <div className="rounded-lg border border-border overflow-hidden w-full">
                        {/* Column Headers */}
                        <div
                          className={`grid ${gridCols} items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground font-medium bg-muted/50 border-b border-border`}
                        >
                          <div className="w-6" />
                          <div>
                            <Trans>Period</Trans>
                          </div>
                          <div>
                            <Trans>Scheduled</Trans>
                          </div>
                          <div>
                            <Trans>Source</Trans>
                          </div>
                          <div className="text-right">
                            <Trans>Amount</Trans>
                          </div>
                        </div>

                        {/* Lines */}
                        <div className="divide-y divide-border">
                          {section.lines.map((line, index) => (
                            <div
                              key={line.id}
                              className={`grid ${gridCols} items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors`}
                            >
                              <div className="w-6 text-muted-foreground tabular-nums">
                                {index + 1}
                              </div>
                              <div>
                                {formatDate(line.schedule?.periodStart)} →{" "}
                                {formatDate(line.schedule?.periodEnd)}
                              </div>
                              <div>
                                {formatDate(line.schedule?.scheduledDate)}
                              </div>
                              <div>
                                {line.schedule?.salesInvoiceLineId &&
                                sources[line.schedule.salesInvoiceLineId] ? (
                                  <Link
                                    to={
                                      sources[line.schedule.salesInvoiceLineId]
                                        .to
                                    }
                                    className="hover:underline"
                                  >
                                    {
                                      sources[line.schedule.salesInvoiceLineId]
                                        .label
                                    }
                                  </Link>
                                ) : (
                                  <span className="text-muted-foreground font-mono text-xs">
                                    {line.schedule?.rentalAgreementLineId ??
                                      "—"}
                                  </span>
                                )}
                              </div>
                              <div className="text-right tabular-nums font-medium">
                                {currencyFormatter.format(Number(line.amount))}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Totals */}
                        <div
                          className={`grid ${gridCols} items-center gap-3 px-4 py-3 bg-muted/50 border-t border-border`}
                        >
                          <div className="w-6" />
                          <div className="text-sm font-medium">
                            {lineCount === 1
                              ? t`1 line`
                              : t`${lineCount} lines`}
                          </div>
                          <div />
                          <div />
                          <div className="text-right font-mono text-sm tabular-nums font-medium">
                            {currencyFormatter.format(sectionTotal)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Outlet />

        <ConfirmDelete
          action={path.to.deleteRevenueRecognitionRun(runId)}
          isOpen={deleteModal.isOpen}
          name={run.runId}
          text={t`Are you sure you want to delete ${run.runId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={() => {
            deleteModal.onClose();
            navigate(path.to.revenueRecognitionRuns);
          }}
        />

        <Confirm
          action={path.to.repeatRevenueRecognitionRun(runId)}
          isOpen={repeatModal.isOpen}
          title={t`Repeat Run`}
          text={t`This will create a draft revenue recognition run for the next period, ending ${formatDate(nextPeriodEnd)}. Every schedule row due on or before that date will be included.`}
          confirmText={t`Create Run`}
          onCancel={repeatModal.onClose}
          onSubmit={repeatModal.onClose}
        />
      </div>
    </div>
  );
}
