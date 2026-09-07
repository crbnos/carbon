import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Skeleton
} from "@carbon/react";
import type { useSortable } from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import {
  LuArrowUpRight,
  LuEllipsisVertical,
  LuEyeOff,
  LuGripVertical
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
  WidgetKey,
  WidgetPayload
} from "../dashboard.models";
import { DASHBOARD_RANGES, resolveDashboardRange } from "../dashboard.models";
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
  const to = widgetLinks[widget.key as keyof typeof widgetLinks];

  return (
    <Card className="shadow-none h-full">
      <CardHeader className="flex-row items-start gap-2">
        {dragHandle ? (
          <button
            type="button"
            ref={dragHandle.ref}
            aria-label={t`Drag to reorder`}
            className="flex-shrink-0 -ml-2 -my-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-grab active:cursor-grabbing touch-none"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            <LuGripVertical className="w-4 h-4" />
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          <CardTitle
            className="truncate line-clamp-none"
            title={labels.description}
          >
            {labels.title}
          </CardTitle>
          {widget.supportsRange && widget.range ? (
            <span className="text-xs text-muted-foreground">
              {rangeLabels[widget.range]}
            </span>
          ) : null}
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
              aria-label={t`Widget options`}
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
                    {t`Follow page range`}
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
              <LuEyeOff className="mr-2 w-4 h-4" />
              {t`Hide widget`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetSkeleton kind={widget.kind} />
        ) : (
          <WidgetBody
            widget={widget}
            payload={fetcher.data!}
            formatValue={formatValue}
          />
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
  return <Skeleton className="h-40 w-full" />;
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
