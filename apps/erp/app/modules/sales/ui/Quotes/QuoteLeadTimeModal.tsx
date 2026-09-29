import {
  Badge,
  Button,
  cn,
  DatePicker,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import {
  type CalendarDate,
  getLocalTimeZone,
  today
} from "@internationalized/date";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { action } from "~/routes/x+/quote+/$quoteId.$lineId.lead-time";
import { path } from "~/utils/path";

type Constraint = "queued" | "bestCase" | "target";

// Plural via <Plural> so "day"/"days" is translated, not interpolated as a
// runtime English literal.
const Days = ({ value }: { value: number }) => (
  <Plural value={value} one="# day" other="# days" />
);

const HEAD_CELL = "whitespace-nowrap py-2 pr-6 text-left font-medium";
const CELL = "py-3 pr-6 align-top";

type QuoteLeadTimeModalProps = {
  quoteId: string;
  lineId: string;
  quantities: number[];
  isEditable: boolean;
  onApply: (leadTimeByQuantity: Record<number, number>) => Promise<void>;
  onClose: () => void;
};

const QuoteLeadTimeModal = ({
  quoteId,
  lineId,
  quantities,
  isEditable,
  onApply,
  onClose
}: QuoteLeadTimeModalProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof action>();

  const [constraint, setConstraint] = useState<Constraint>("queued");
  const [targetDate, setTargetDate] = useState<CalendarDate | null>(null);
  const [applying, setApplying] = useState(false);

  const leadTimeAction = path.to.quoteLineLeadTime(quoteId, lineId);

  // Predict on mount (queued + best case). The target verdict needs a due date,
  // so it is only requested when the estimator picks one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    fetcher.submit(
      { quantities },
      { method: "post", encType: "application/json", action: leadTimeAction }
    );
  }, []);

  const onTargetDateChange = (date: CalendarDate | null) => {
    setTargetDate(date);
    if (date) {
      fetcher.submit(
        { quantities, dueDate: date.toString() },
        { method: "post", encType: "application/json", action: leadTimeAction }
      );
    }
  };

  const loading = fetcher.state !== "idle";
  const forecast = fetcher.data?.forecast ?? null;
  const error = fetcher.data?.error ?? null;

  const localToday = today(getLocalTimeZone());
  const targetLeadTime = targetDate ? targetDate.compare(localToday) : null;

  const rows = forecast?.quantities ?? [];
  const anyLate =
    constraint === "target" &&
    rows.some((row) => row.target?.verdict === "late");

  // A break the scheduler could not place has no estimate; applying would
  // silently update only the others.
  const anyUnestimated =
    constraint !== "target" &&
    rows.some((row) => row[constraint].leadTimeDays === null);

  const applyDisabled =
    !isEditable ||
    loading ||
    !forecast ||
    anyUnestimated ||
    (constraint === "target" && (!targetDate || anyLate));

  const handleApply = async () => {
    if (!forecast) return;
    const map: Record<number, number> = {};
    for (const row of rows) {
      if (constraint === "target") {
        if (targetLeadTime !== null) map[row.quantity] = targetLeadTime;
      } else {
        const days = row[constraint].leadTimeDays;
        if (days !== null) map[row.quantity] = days;
      }
    }
    setApplying(true);
    try {
      await onApply(map);
      onClose();
    } catch {
      // onApply already reported the failure; stay open so it can be retried.
    } finally {
      setApplying(false);
    }
  };

  const constraintHelp =
    constraint === "queued" ? (
      <Trans>
        If ordered today — placed behind everything already released.
      </Trans>
    ) : constraint === "bestCase" ? (
      <Trans>As if it jumped to the front of the shop's queue.</Trans>
    ) : (
      <Trans>Both finishes compared against a date you choose.</Trans>
    );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Predict lead time</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Scheduled against your shop's current workload. Nothing is saved
              until you apply.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-1.5">
            <Tabs
              value={constraint}
              onValueChange={(value) => setConstraint(value as Constraint)}
            >
              <TabsList>
                <TabsTrigger value="queued">
                  <Trans>End of queue</Trans>
                </TabsTrigger>
                <TabsTrigger value="bestCase">
                  <Trans>Best case</Trans>
                </TabsTrigger>
                <TabsTrigger value="target">
                  <Trans>Target date</Trans>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex min-h-9 flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground text-pretty">
                {constraintHelp}
              </p>
              {constraint === "target" && (
                <DatePicker
                  aria-label={t`Target date`}
                  value={targetDate}
                  onChange={onTargetDateChange}
                  minValue={localToday}
                />
              )}
            </div>
          </div>

          <div className="mt-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Spinner className="size-6" />
                <p className="text-sm text-muted-foreground">
                  <Trans>Predicting lead time…</Trans>
                </p>
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-4 text-destructive">
                <LuTriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">
                    <Trans>Could not predict lead time</Trans>
                  </p>
                  <p className="text-sm opacity-90">{error}</p>
                </div>
              </div>
            ) : !forecast ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                <Trans>This line has no routing to schedule.</Trans>
              </p>
            ) : constraint === "target" && !targetDate ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                <Trans>Pick a target date to compare.</Trans>
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className={HEAD_CELL}>
                          <Trans>Qty</Trans>
                        </th>
                        <th className={HEAD_CELL}>
                          <Trans>Materials</Trans>
                        </th>
                        {constraint === "target" ? (
                          <>
                            <th className={HEAD_CELL}>
                              <Trans>Queued finish</Trans>
                            </th>
                            <th className={HEAD_CELL}>
                              <Trans>Best-case finish</Trans>
                            </th>
                            <th className={HEAD_CELL}>
                              <Trans>Verdict</Trans>
                            </th>
                            <th className={cn(HEAD_CELL, "pr-0")}>
                              <Trans>Lead time</Trans>
                            </th>
                          </>
                        ) : (
                          <>
                            <th className={HEAD_CELL}>
                              <Trans>Finish</Trans>
                            </th>
                            <th className={HEAD_CELL}>
                              <Trans>Lead time</Trans>
                            </th>
                            <th className={cn(HEAD_CELL, "pr-0")}>
                              <Trans>Bottleneck</Trans>
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => {
                        const materials =
                          row.materialReadyDays > 0 ? (
                            <Days value={row.materialReadyDays} />
                          ) : (
                            "—"
                          );
                        if (constraint === "target") {
                          const target = row.target;
                          return (
                            <tr key={row.quantity}>
                              <td
                                className={cn(
                                  CELL,
                                  "font-medium tabular-nums text-foreground"
                                )}
                              >
                                {row.quantity}
                              </td>
                              <td
                                className={cn(
                                  CELL,
                                  "tabular-nums text-muted-foreground"
                                )}
                              >
                                {materials}
                              </td>
                              <td
                                className={cn(
                                  CELL,
                                  "whitespace-nowrap tabular-nums"
                                )}
                              >
                                {row.queued.finishAt
                                  ? formatDate(row.queued.finishAt.slice(0, 10))
                                  : "—"}
                              </td>
                              <td
                                className={cn(
                                  CELL,
                                  "whitespace-nowrap tabular-nums"
                                )}
                              >
                                {row.bestCase.finishAt
                                  ? formatDate(
                                      row.bestCase.finishAt.slice(0, 10)
                                    )
                                  : "—"}
                              </td>
                              <td className={CELL}>
                                {target ? (
                                  <div className="flex flex-col items-start gap-1">
                                    {target.verdict === "on-time" ? (
                                      <Badge variant="green">
                                        <Trans>On time</Trans>
                                      </Badge>
                                    ) : target.verdict === "expedite" ? (
                                      <Badge variant="orange">
                                        <Trans>Needs expedite</Trans>
                                      </Badge>
                                    ) : (
                                      <Badge variant="red">
                                        <Trans>Not feasible</Trans>
                                      </Badge>
                                    )}
                                    <span className="tabular-nums text-muted-foreground">
                                      {target.slackDays >= 0 ? (
                                        <Plural
                                          value={target.slackDays}
                                          one="# day of slack"
                                          other="# days of slack"
                                        />
                                      ) : (
                                        <Plural
                                          value={-target.slackDays}
                                          one="# day short"
                                          other="# days short"
                                        />
                                      )}
                                    </span>
                                  </div>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td
                                className={cn(
                                  CELL,
                                  "pr-0 font-medium tabular-nums text-foreground"
                                )}
                              >
                                {targetLeadTime !== null ? (
                                  <Days value={targetLeadTime} />
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          );
                        }
                        const scenario = row[constraint];
                        return (
                          <tr key={row.quantity}>
                            <td
                              className={cn(
                                CELL,
                                "font-medium tabular-nums text-foreground"
                              )}
                            >
                              {row.quantity}
                            </td>
                            <td
                              className={cn(
                                CELL,
                                "tabular-nums text-muted-foreground"
                              )}
                            >
                              {materials}
                            </td>
                            <td
                              className={cn(
                                CELL,
                                "whitespace-nowrap tabular-nums"
                              )}
                            >
                              {scenario.finishAt
                                ? formatDate(scenario.finishAt.slice(0, 10))
                                : "—"}
                            </td>
                            <td
                              className={cn(
                                CELL,
                                "font-medium tabular-nums text-foreground"
                              )}
                            >
                              {scenario.leadTimeDays !== null ? (
                                <Days value={scenario.leadTimeDays} />
                              ) : (
                                "—"
                              )}
                            </td>
                            <td
                              className={cn(
                                CELL,
                                "pr-0 text-muted-foreground text-pretty"
                              )}
                            >
                              {scenario.cause ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5 flex flex-col gap-1 border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    <Trans>Assumptions</Trans>
                  </p>
                  <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {forecast.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                    {forecast.zeroStandardOperationCount > 0 && (
                      <li>
                        <Plural
                          value={forecast.zeroStandardOperationCount}
                          one="# operation has no time standards"
                          other="# operations have no time standards"
                        />
                      </li>
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          {isEditable ? (
            anyLate ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button isDisabled>
                      <Trans>Apply</Trans>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <Trans>One or more quantities cannot meet this date</Trans>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                isDisabled={applyDisabled}
                isLoading={applying}
                onClick={handleApply}
              >
                <Trans>Apply</Trans>
              </Button>
            )
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default QuoteLeadTimeModal;
