import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Spinner
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import type {
  DelayClass,
  DelayKind,
  DelayResult,
  DelayStep
} from "~/modules/production/delay";
import { path } from "~/utils/path";

export function DelayAnalysis({
  type,
  id
}: {
  type: "job" | "sales-order" | "purchase-order";
  id: string;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<DelayResult>();
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);

  return (
    <Accordion
      type="single"
      collapsible
      value={open ? "delay" : ""}
      onValueChange={(value) => {
        const next = value === "delay";
        setOpen(next);
        if (next && !started) {
          setStarted(true);
          fetcher.load(path.to.api.delay(type, id));
        }
      }}
      className="w-full border-t border-border pt-2"
    >
      <AccordionItem value="delay" className="border-none">
        <AccordionTrigger className="py-2 text-sm hover:no-underline">
          {t`Delay analysis`}
        </AccordionTrigger>
        <AccordionContent>
          {!started || fetcher.state === "loading" ? (
            open ? (
              <Spinner className="h-4 w-4" />
            ) : null
          ) : fetcher.data ? (
            <DelayBody result={fetcher.data} type={type} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t`Couldn't load delay analysis.`}
            </p>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function DelayBody({
  result,
  type
}: {
  result: DelayResult;
  type: "job" | "sales-order" | "purchase-order";
}) {
  const { t } = useLingui();
  const days = (count: number) =>
    count === 1 ? t`${count} day` : t`${count} days`;

  const classLabel = (value: DelayClass) => {
    switch (value) {
      case "late_supply":
        return t`Late supply`;
      case "outside_processing":
        return t`Outside processing returned late`;
      case "quality_hold":
        return t`Quality hold`;
      case "ran_long":
        return t`Operation ran long`;
      case "started_late":
        return t`Operation started late`;
      case "completed_late":
        return t`Completed late`;
      case "shipped_late":
        return t`Shipped late`;
    }
  };

  const kindLabel = (value: DelayKind) => {
    switch (value) {
      case "supply":
        return t`Supply`;
      case "outside":
        return t`Outside processing`;
      case "quality":
        return t`Quality hold`;
      case "operation":
        return t`Operation`;
      case "job":
        return t`Job`;
      case "salesLine":
        return t`Sales order`;
    }
  };

  const nameOf = (step: { kind: DelayKind; label?: string }) =>
    step.label ?? kindLabel(step.kind);

  if ("cycle" in result) {
    const from = nameOf(result.cycle.from);
    const to = nameOf(result.cycle.to);
    return (
      <p className="text-xs text-muted-foreground">
        {t`${from} and ${to} depend on each other.`}
      </p>
    );
  }

  const quiet = result.reports.every(
    (report) =>
      report.lateDays === 0 &&
      report.causes.length === 0 &&
      report.impacts.length === 0 &&
      report.absorbed.length === 0 &&
      report.gaps.length === 0
  );
  if (quiet) {
    return <p className="text-xs text-muted-foreground">{t`Not late.`}</p>;
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      {result.reports.map((report, index) => (
        <div key={index} className="flex flex-col gap-2">
          {type !== "job" && report.label ? (
            <span className="text-xs font-medium">
              {report.href ? (
                <Link to={report.href} className="underline">
                  {report.label}
                </Link>
              ) : (
                report.label
              )}
            </span>
          ) : null}
          {report.lateDays > 0 ? (
            <p className="text-xs">{t`${days(report.lateDays)} late`}</p>
          ) : null}
          {type === "purchase-order" &&
          report.causes.length === 0 &&
          report.impacts.length === 0 &&
          report.lateDays > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t`Nothing open is pushed past its date.`}
            </p>
          ) : null}
          {report.causes.map((cause, causeIndex) => (
            <div key={causeIndex} className="text-xs">
              <span>
                {classLabel(cause.class)} · {days(cause.days)}
              </span>
              <Chain steps={cause.steps} nameOf={nameOf} />
            </div>
          ))}
          {report.impacts.map((impact, impactIndex) => {
            const hit = impact.steps[impact.steps.length - 1];
            return (
              <div key={impactIndex} className="text-xs">
                <span>
                  {hit ? nameOf(hit) : classLabel(impact.class)} ·{" "}
                  {days(impact.days)}
                </span>
                <Chain steps={impact.steps} nameOf={nameOf} />
              </div>
            );
          })}
          {report.absorbed.length > 0 &&
          !(
            type === "purchase-order" &&
            report.causes.length === 0 &&
            report.impacts.length === 0 &&
            report.lateDays > 0
          ) ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t`Late, with enough slack`}
              </span>
              {report.absorbed.map((item, itemIndex) => (
                <span key={itemIndex} className="text-xs text-muted-foreground">
                  {classLabel(item.class)} · {days(item.days)}
                  {item.label ? (
                    <>
                      {" · "}
                      {item.href ? (
                        <Link to={item.href} className="underline">
                          {item.label}
                        </Link>
                      ) : (
                        item.label
                      )}
                    </>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
          {report.gaps.map((gap, gapIndex) => {
            const successor = nameOf(gap.to);
            const predecessor = nameOf(gap.from);
            const span = days(gap.days);
            return (
              <p key={gapIndex} className="text-xs text-muted-foreground">
                {t`${successor} is planned ${span} before ${predecessor}.`}
                {gap.recorded ? null : ` ${t`Inferred.`}`}
              </p>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Chain({
  steps,
  nameOf
}: {
  steps: DelayStep[];
  nameOf: (step: DelayStep) => string;
}) {
  const { t } = useLingui();
  if (steps.length < 2) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {steps.map((step, index) => (
        <span key={index}>
          {index > 0 ? " → " : null}
          {step.label && step.href ? (
            <Link to={step.href} className="underline">
              {step.label}
            </Link>
          ) : (
            nameOf(step)
          )}
          {index > 0 && !step.recorded ? ` (${t`inferred`})` : null}
        </span>
      ))}
    </p>
  );
}
