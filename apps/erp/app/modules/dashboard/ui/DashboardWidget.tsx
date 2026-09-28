import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Skeleton
} from "@carbon/react";
import type { useSortable } from "@dnd-kit/sortable";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import {
  LuArrowUpRight,
  LuEllipsisVertical,
  LuEyeOff,
  LuGripVertical,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useRevalidator } from "react-router";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useQuantityFormatter
} from "~/hooks";
import { path } from "~/utils/path";
import { useDashboardRangeLabels, useWidgetLabels } from "../dashboard.labels";
import { widgetLinks } from "../dashboard.links";
import type {
  DashboardRange,
  ResolvedWidget,
  WidgetKey
} from "../dashboard.models";
import { DASHBOARD_RANGES, resolveDashboardRange } from "../dashboard.models";
import type { WidgetPayload } from "../types";
import { BreakdownWidget } from "./BreakdownWidget";
import { ListWidget } from "./ListWidget";
import { StatWidget } from "./StatWidget";
import { TrendWidget } from "./TrendWidget";

const FOLLOW_PAGE = "__page__";

/** What the sortable wrapper hands the card so its grip starts a drag. */
export type WidgetDragHandle = {
  ref: ReturnType<typeof useSortable>["setActivatorNodeRef"];
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
};

/**
 * One card: owns the data fetch for its (possibly overridden) window, the
 * loading/empty states, the drill-down link, the drag grip, and the menu
 * (hide, and the per-widget range when the widget supports one).
 */
export function DashboardWidget({
  widget,
  pageRange,
  today,
  dragHandle
}: {
  widget: ResolvedWidget;
  pageRange: DashboardRange;
  today: string;
  dragHandle?: WidgetDragHandle;
}) {
  const { t } = useLingui();
  const rangeLabels = useDashboardRangeLabels();
  const labels = useWidgetLabels()[widget.key as WidgetKey];
  const fetcher = useFetcher<WidgetPayload>();
  const layoutFetcher = useFetcher();
  const revalidator = useRevalidator();

  const effectiveRange = widget.range ?? pageRange;
  const window = useMemo(
    () => resolveDashboardRange(effectiveRange, today),
    [effectiveRange, today]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher.load is stable; re-fetch only when the window changes
  useEffect(() => {
    fetcher.load(
      `${path.to.api.dashboardWidget(widget.key)}?start=${window.start}&end=${window.end}&today=${today}`
    );
  }, [widget.key, window.start, window.end, today]);

  const money = useCurrencyFormatter();
  const percent = usePercentFormatter();
  const quantity = useQuantityFormatter();
  const formatValue = (value: number) => {
    switch (widget.valueKind) {
      case "money":
        return money.format(value);
      case "percent":
        return percent.format(value / 100);
      default:
        return quantity(value);
    }
  };

  const saveLayout = (visible: boolean, range: DashboardRange | null) => {
    layoutFetcher.submit(
      JSON.stringify({ widgets: [{ key: widget.key, visible, range }] }),
      {
        method: "post",
        action: path.to.api.dashboardLayout,
        encType: "application/json"
      }
    );
  };

  const setRange = (next: string) => {
    const range = next === FOLLOW_PAGE ? null : (next as DashboardRange);
    if (range === widget.range) return;
    saveLayout(true, range);
  };

  // Hiding keeps the range override, so re-adding the widget from the
  // catalog brings its window back.
  const hide = () => saveLayout(false, widget.range);

  // Once the override is saved, re-read the layout so the card re-fetches
  // with its new window (or disappears, when hidden).
  // biome-ignore lint/correctness/useExhaustiveDependencies: revalidate only when the save settles
  useEffect(() => {
    if (layoutFetcher.state === "idle" && layoutFetcher.data) {
      revalidator.revalidate();
    }
  }, [layoutFetcher.state, layoutFetcher.data]);

  const isLoading = fetcher.state !== "idle" || !fetcher.data;
  // A 404/500 from the widget route arrives as data without a `kind`; that is a
  // failed load, and it must not read as "no data".
  const payload =
    fetcher.data && "kind" in fetcher.data ? fetcher.data : undefined;
  const to = widgetLinks[widget.key as keyof typeof widgetLinks];

  return (
    <Card className="shadow-none h-full">
      <CardHeader className="flex-row items-start gap-2">
        {dragHandle ? (
          <IconButton
            ref={dragHandle.ref}
            aria-label={t`Drag to reorder`}
            icon={<LuGripVertical />}
            variant="ghost"
            size="sm"
            className="flex-shrink-0 -ml-2 -my-1 text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          />
        ) : null}
        <div className="flex-1 min-w-0 flex flex-col">
          <CardTitle>{labels.title}</CardTitle>
          <CardDescription className="truncate">
            {widget.supportsRange && widget.range
              ? rangeLabels[widget.range]
              : labels.description}
          </CardDescription>
        </div>
        {to ? (
          <Button
            asChild
            variant="secondary"
            size="sm"
            rightIcon={<LuArrowUpRight />}
            className="flex-shrink-0 -my-1"
          >
            <Link to={to}>{t`View`}</Link>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`More options`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
              size="sm"
              className="flex-shrink-0 -my-1"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {widget.supportsRange ? (
              <>
                <DropdownMenuRadioGroup
                  value={widget.range ?? FOLLOW_PAGE}
                  onValueChange={setRange}
                >
                  <DropdownMenuRadioItem value={FOLLOW_PAGE}>
                    {t`Follow Page Range`}
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {DASHBOARD_RANGES.map((range) => (
                    <DropdownMenuRadioItem key={range} value={range}>
                      {rangeLabels[range]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onClick={hide}>
              <DropdownMenuIcon icon={<LuEyeOff />} />
              {t`Hide Widget`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetSkeleton kind={widget.kind} />
        ) : payload ? (
          <WidgetBody
            widget={widget}
            payload={payload}
            formatValue={formatValue}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground h-10">
            <LuTriangleAlert className="size-4 shrink-0 text-red-500" />
            <Trans>Failed to load widget</Trans>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WidgetSkeleton({ kind }: { kind: ResolvedWidget["kind"] }) {
  if (kind === "stat") {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    );
  }
  return <Skeleton className="flex-1 min-h-40 w-full" />;
}

function WidgetBody({
  widget,
  payload,
  formatValue
}: {
  widget: ResolvedWidget;
  payload: WidgetPayload;
  formatValue: (value: number) => string;
}) {
  switch (payload.kind) {
    case "stat":
      return <StatWidget widget={widget} payload={payload} />;
    case "trend":
      return <TrendWidget payload={payload} formatValue={formatValue} />;
    case "breakdown":
      return <BreakdownWidget payload={payload} formatValue={formatValue} />;
    case "list":
      return <ListWidget payload={payload} />;
  }
}
