import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useDateFormatter } from "~/hooks";
import type { DemandForecastSourceRow } from "~/modules/items/items.service";
import { path } from "~/utils/path";

type Props = {
  sources: DemandForecastSourceRow[];
  forecastQuantity: number;
  forecastMethod: string | null;
  children: ReactNode;
};

export function DemandForecastSourcesPopover({
  sources,
  forecastQuantity,
  forecastMethod,
  children
}: Props) {
  const numberFormatter = useNumberFormatter();
  const { formatDate } = useDateFormatter();

  // Non-MRP forecasts (manual / statistical / ml) have no traceable sources.
  if (forecastMethod !== "mrp") {
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-2 p-2">
            <div className="text-sm font-medium">
              <Trans>Demand Forecast</Trans>
            </div>
            <div className="text-xs text-muted-foreground">
              <Trans>
                Forecast method:{" "}
                <span className="font-mono">{forecastMethod ?? "unknown"}</span>
                . This row was not derived from active jobs, so no parent
                sources are available.
              </Trans>
            </div>
            <div className="text-sm">
              <Trans>
                Quantity: {numberFormatter.format(forecastQuantity)}
              </Trans>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  if (sources.length === 0) {
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-2 p-2">
            <div className="text-sm font-medium">
              <Trans>Demand Forecast</Trans>
            </div>
            <div className="text-xs text-muted-foreground">
              <Trans>
                No parent sources recorded yet. Click Recalculate on the
                planning page to refresh attribution.
              </Trans>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-xl max-h-112 overflow-y-auto pointer-events-auto"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">
            <Trans>Demand Forecast — Driven by</Trans>
          </div>
          <div className="text-xs text-muted-foreground">
            <Trans>
              Demand forecast = BOM-exploded demand from open sales orders,
              active jobs, and production projections.
            </Trans>
          </div>
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Source</Trans>
                </Th>
                <Th>
                  <Trans>Parent Item</Trans>
                </Th>
                <Th>
                  <Trans>Due</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Qty</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {sources.map((s, i) => {
                // Pick the date that matters for each source type:
                //   Job Material   → the job's due date
                //   Sales Order    → the SO line's promised date
                //   Demand Projection → the projection's period start
                const sourceDate =
                  s.sourceType === "Job Material"
                    ? s.job?.dueDate
                    : s.sourceType === "Sales Order"
                      ? s.salesOrderLine?.promisedDate
                      : s.sourceType === "Demand Projection"
                        ? s.demandProjection?.period?.startDate
                        : null;
                return (
                  <Tr key={i}>
                    <Td>
                      {s.sourceType === "Job Material" && s.job ? (
                        <Link
                          to={path.to.job(s.job.id)}
                          className="text-primary hover:underline"
                        >
                          {s.job.jobId}
                        </Link>
                      ) : s.sourceType === "Sales Order" &&
                        s.salesOrderLine?.salesOrder ? (
                        <Link
                          to={path.to.salesOrder(
                            s.salesOrderLine.salesOrder.id
                          )}
                          className="text-primary hover:underline"
                        >
                          {s.salesOrderLine.salesOrder.salesOrderId}
                        </Link>
                      ) : s.sourceType === "Demand Projection" &&
                        s.demandProjection ? (
                        s.parentItemId && s.locationId ? (
                          <Link
                            to={path.to.demandProjection(
                              s.parentItemId,
                              s.locationId
                            )}
                            className="text-primary hover:underline"
                            title={s.demandProjection.notes ?? undefined}
                          >
                            <Trans>Projection</Trans>
                            {/* <span className="ml-1 text-xs text-muted-foreground font-mono">
                            {s.demandProjection.forecastMethod ?? "manual"}
                          </span> */}
                          </Link>
                        ) : (
                          <span
                            className="text-sm text-foreground"
                            title={s.demandProjection.notes ?? undefined}
                          >
                            <Trans>Projection</Trans>
                            <span className="ml-1 text-xs text-muted-foreground font-mono">
                              {s.demandProjection.forecastMethod ?? "manual"}
                            </span>
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      {s.parentItem ? (
                        <span title={s.parentItem.name}>
                          {s.parentItem.readableId}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      {sourceDate ? (
                        formatDate(sourceDate)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {numberFormatter.format(s.quantity)}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </PopoverContent>
    </Popover>
  );
}
