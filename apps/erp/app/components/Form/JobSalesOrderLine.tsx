/**
 * `<JobSalesOrderLine>` — picks a sales order line to link a job to. Lists only
 * lines whose item matches the job's item, on sales orders that are still open
 * (not Completed/Invoiced/Cancelled/Closed). Backed by the per-job endpoint
 * `api/production/job/:jobId/sales-order-lines`.
 *
 * Form-bound like the other property selectors: render it inside a
 * `ValidatedForm` and give it a `name`.
 */

import type { ComboboxProps } from "@carbon/form";
import { Combobox, FieldEmptyState } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import type { getOpenSalesOrderLinesForItem } from "~/modules/sales";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";

type OpenSalesOrderLine = NonNullable<
  Awaited<ReturnType<typeof getOpenSalesOrderLinesForItem>>["data"]
>[number];

type JobSalesOrderLineProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  jobId: string;
  /** Render a compact inline preview (property panels) once a value is set. */
  inline?: boolean;
  onChange?: (line: OpenSalesOrderLine | null) => void;
};

const salesOrderLinePreview = (
  value: string,
  options: { value: string; label: ReactNode; helper?: string }[]
) => {
  const match = options.find((o) => o.value === value);
  return <span className="text-sm">{match?.label ?? ""}</span>;
};

const JobSalesOrderLine = ({
  jobId,
  inline,
  onChange,
  ...props
}: JobSalesOrderLineProps) => {
  const { t } = useLingui();
  const [customers] = useCustomers();

  const fetcher =
    useFetcher<Awaited<ReturnType<typeof getOpenSalesOrderLinesForItem>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  useEffect(() => {
    if (jobId) fetcher.load(path.to.api.jobSalesOrderLines(jobId));
  }, [jobId]);

  const lines = fetcher.data?.data ?? [];

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) map.set(customer.id, customer.name);
    return map;
  }, [customers]);

  const options = useMemo(
    () =>
      lines.map((line) => {
        const customerName = line.salesOrder?.customerId
          ? customerNameById.get(line.salesOrder.customerId)
          : undefined;
        const quantity =
          line.saleQuantity != null ? `Qty ${line.saleQuantity}` : undefined;
        const helper = [customerName, quantity].filter(Boolean).join(" · ");
        return {
          value: line.id,
          label: line.salesOrder?.salesOrderId ?? line.id,
          helper: helper || undefined
        };
      }),
    [lines, customerNameById]
  );

  return (
    <Combobox
      options={options}
      {...props}
      label={props.label ?? t`Target`}
      placeholder={props.placeholder ?? t`Link to sales order line`}
      emptyMessage={
        props.emptyMessage ?? (
          <FieldEmptyState
            title={t`No open sales order lines`}
            description={t`No open orders for this item are available to link.`}
          />
        )
      }
      inline={inline ? salesOrderLinePreview : undefined}
      onChange={(option) =>
        onChange?.(lines.find((line) => line.id === option?.value) ?? null)
      }
    />
  );
};

export default JobSalesOrderLine;
