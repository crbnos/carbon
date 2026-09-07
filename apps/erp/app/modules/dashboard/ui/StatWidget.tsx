import { cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuMoveDownRight, LuMoveUpRight } from "react-icons/lu";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useQuantityFormatter
} from "~/hooks";
import type {
  ResolvedWidget,
  StatPayload,
  WidgetValueKind
} from "../dashboard.models";
import { percentChange } from "../dashboard.models";

function useStatFormatter(kind: WidgetValueKind | undefined) {
  const money = useCurrencyFormatter();
  const percent = usePercentFormatter();
  const quantity = useQuantityFormatter();
  return (value: number) => {
    switch (kind) {
      case "money":
        return money.format(value);
      case "percent":
        // Stored as a percentage (0–100); Intl percent style expects a fraction.
        return percent.format(value / 100);
      default:
        return quantity(value);
    }
  };
}

/** Big number + delta vs the prior window, coloured by the widget's goal. */
export function StatWidget({
  widget,
  payload
}: {
  widget: ResolvedWidget;
  payload: StatPayload;
}) {
  const format = useStatFormatter(widget.valueKind);
  const percent = usePercentFormatter();
  const change =
    payload.previous === undefined
      ? null
      : percentChange(payload.value, payload.previous);

  // Positive change is good for "higher" goals, bad for "lower" ones; with no
  // goal (or no prior value) the delta is informational only.
  const tone =
    change === null || change === 0 || !widget.goal
      ? "neutral"
      : change > 0 === (widget.goal === "higher")
        ? "good"
        : "bad";

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-4xl font-medium tracking-tighter tabular-nums truncate">
        {payload.empty && widget.valueKind === "percent"
          ? "—"
          : format(payload.value)}
      </h3>
      {change !== null ? (
        <span
          className={cn(
            "flex items-center gap-1 text-xs tabular-nums",
            tone === "good" && "text-emerald-600 dark:text-emerald-500",
            tone === "bad" && "text-red-600 dark:text-red-500",
            tone === "neutral" && "text-muted-foreground"
          )}
        >
          {change > 0 ? (
            <LuMoveUpRight className="size-3" />
          ) : change < 0 ? (
            <LuMoveDownRight className="size-3" />
          ) : null}
          {percent.format(Math.abs(change) / 100)}{" "}
          <Trans>vs prior period</Trans>
        </span>
      ) : payload.detail !== undefined ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          <Trans>{payload.detail} lines past due</Trans>
        </span>
      ) : null}
    </div>
  );
}
