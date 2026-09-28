import { Badge } from "@carbon/react";
import { round } from "@carbon/utils";
import { Plural, Trans } from "@lingui/react/macro";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useQuantityFormatter
} from "~/hooks";
import type { ResolvedWidget, WidgetValueKind } from "../dashboard.models";
import { percentChange } from "../dashboard.models";
import type { StatPayload } from "../types";

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

/**
 * Big number + delta vs the prior window. The delta is a green/red Badge, the
 * way the purchasing dashboard shows its period change — never coloured text.
 */
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
    <div className="flex flex-col gap-2">
      <h3 className="text-4xl font-medium tracking-tighter tabular-nums truncate">
        {payload.empty && widget.valueKind === "percent"
          ? "—"
          : format(payload.value)}
      </h3>
      {change !== null ? (
        <div className="flex items-center gap-2 min-w-0">
          <Badge
            variant={
              tone === "good" ? "green" : tone === "bad" ? "red" : "outline"
            }
            className="shrink-0 tabular-nums"
          >
            {change > 0 ? "+" : ""}
            {percent.format(round(change, 0) / 100)}
          </Badge>
          <span className="text-xs text-muted-foreground truncate">
            <Trans>vs prior period</Trans>
          </span>
        </div>
      ) : payload.detail !== undefined ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          <Plural
            value={payload.detail}
            one="# line past due"
            other="# lines past due"
          />
        </span>
      ) : null}
    </div>
  );
}
