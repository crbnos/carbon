import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DatePicker,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Table,
  Tabs,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import {
  type CalendarDate,
  getLocalTimeZone,
  today
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { action } from "~/routes/x+/quote+/$quoteId.$lineId.lead-time";
import { path } from "~/utils/path";

type Constraint = "queued" | "bestCase" | "target";

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

  const applyDisabled =
    !isEditable ||
    loading ||
    !forecast ||
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
    } finally {
      setApplying(false);
    }
  };

  const daysLabel = (days: number) => t`${days} ${days === 1 ? "day" : "days"}`;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xxlarge">
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
          <div className="flex flex-wrap items-center gap-4 pt-2">
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
            {constraint === "target" && (
              <DatePicker
                aria-label={t`Target date`}
                value={targetDate}
                onChange={onTargetDateChange}
                minValue={localToday}
              />
            )}
          </div>
        </ModalHeader>
        <ModalBody>
          {loading ? (
            <div className="flex flex-col h-[118px] w-full items-center justify-center gap-2">
              <Spinner className="size-8" />
              <p className="text-sm">
                <Trans>Predicting lead time…</Trans>
              </p>
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <LuTriangleAlert />
              <AlertTitle>
                <Trans>Could not predict lead time</Trans>
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : !forecast ? (
            <p className="text-sm text-muted-foreground">
              <Trans>This line has no routing to schedule.</Trans>
            </p>
          ) : constraint === "target" && !targetDate ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Pick a target date to compare.</Trans>
            </p>
          ) : (
            <>
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Quantity</Trans>
                    </Th>
                    <Th>
                      <Trans>Materials</Trans>
                    </Th>
                    {constraint === "target" ? (
                      <>
                        <Th>
                          <Trans>Queued finish</Trans>
                        </Th>
                        <Th>
                          <Trans>Best-case finish</Trans>
                        </Th>
                        <Th>
                          <Trans>Verdict</Trans>
                        </Th>
                        <Th>
                          <Trans>Lead time</Trans>
                        </Th>
                      </>
                    ) : (
                      <>
                        <Th>
                          <Trans>Finish</Trans>
                        </Th>
                        <Th>
                          <Trans>Lead time</Trans>
                        </Th>
                        <Th>
                          <Trans>Bottleneck</Trans>
                        </Th>
                      </>
                    )}
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row) => {
                    const materials =
                      row.materialReadyDays > 0
                        ? daysLabel(row.materialReadyDays)
                        : "—";
                    if (constraint === "target") {
                      const target = row.target;
                      return (
                        <Tr key={row.quantity}>
                          <Td>{row.quantity}</Td>
                          <Td>{materials}</Td>
                          <Td>
                            {row.queued.finishAt
                              ? formatDate(row.queued.finishAt.slice(0, 10))
                              : "—"}
                          </Td>
                          <Td>
                            {row.bestCase.finishAt
                              ? formatDate(row.bestCase.finishAt.slice(0, 10))
                              : "—"}
                          </Td>
                          <Td>
                            {target ? (
                              <div className="flex flex-col gap-1">
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
                                <span className="text-xs text-muted-foreground">
                                  {target.slackDays >= 0
                                    ? t`${target.slackDays} ${target.slackDays === 1 ? "day" : "days"} of slack`
                                    : t`${-target.slackDays} ${-target.slackDays === 1 ? "day" : "days"} short`}
                                </span>
                              </div>
                            ) : (
                              "—"
                            )}
                          </Td>
                          <Td>
                            {targetLeadTime !== null
                              ? daysLabel(targetLeadTime)
                              : "—"}
                          </Td>
                        </Tr>
                      );
                    }
                    const scenario = row[constraint];
                    return (
                      <Tr key={row.quantity}>
                        <Td>{row.quantity}</Td>
                        <Td>{materials}</Td>
                        <Td>
                          {scenario.finishAt
                            ? formatDate(scenario.finishAt.slice(0, 10))
                            : "—"}
                        </Td>
                        <Td>
                          {scenario.leadTimeDays !== null
                            ? daysLabel(scenario.leadTimeDays)
                            : "—"}
                        </Td>
                        <Td className="text-muted-foreground">
                          {scenario.cause ?? "—"}
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
              <ul className="mt-4 flex flex-col gap-1 text-xs text-muted-foreground">
                {forecast.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
                {forecast.zeroStandardOperationCount > 0 && (
                  <li>
                    {t`${forecast.zeroStandardOperationCount} ${forecast.zeroStandardOperationCount === 1 ? "operation has" : "operations have"} no time standards`}
                  </li>
                )}
              </ul>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {isEditable ? (
            anyLate ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button isDisabled>
                      <Trans>Apply to all quantities</Trans>
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
                <Trans>Apply to all quantities</Trans>
              </Button>
            )
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default QuoteLeadTimeModal;
