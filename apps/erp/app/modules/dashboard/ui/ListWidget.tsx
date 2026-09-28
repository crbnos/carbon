import { Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { Empty, Hyperlink } from "~/components";
import { JobStatus } from "~/modules/production/ui/Jobs";
import { PurchasingStatus } from "~/modules/purchasing/ui/PurchaseOrder";
import QuoteStatus from "~/modules/sales/ui/Quotes/QuoteStatus";
import { SalesStatus } from "~/modules/sales/ui/SalesOrder";
import { SalesRFQStatus } from "~/modules/sales/ui/SalesRFQ";
import type { ListPayload } from "../types";

type Row = ListPayload["rows"][number];

/** The entity's own Status wrapper, so a job reads the same here as on its page. */
function RowStatus({ row }: { row: Row }) {
  // Each wrapper narrows `status` to its own enum; the API hands us the raw
  // string, which is exactly what each wrapper returns null for when unknown.
  switch (row.entity) {
    case "job":
      return <JobStatus status={row.status as never} />;
    case "purchaseOrder":
      return <PurchasingStatus status={row.status as never} />;
    case "salesOrder":
      return <SalesStatus status={row.status as never} />;
    case "quote":
      return <QuoteStatus status={row.status as never} />;
    case "salesRfq":
      return <SalesRFQStatus status={row.status as never} />;
  }
}

/**
 * Up to eight records as a compact table — identity linked, the entity's
 * Status, a date — the same shape as the module dashboards' assigned lists.
 */
export function ListWidget({ payload }: { payload: ListPayload }) {
  const { locale } = useLocale();
  if (payload.rows.length === 0) {
    return <Empty className="flex-1 min-h-40" />;
  }
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Document</Trans>
          </Th>
          <Th>
            <Trans>Status</Trans>
          </Th>
          <Th>
            <Trans>Date</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {payload.rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <div className="flex flex-col min-w-0">
                <Hyperlink to={row.to} className="whitespace-nowrap">
                  {row.title}
                </Hyperlink>
                {row.subtitle ? (
                  <span className="text-xs text-muted-foreground truncate">
                    {row.subtitle}
                  </span>
                ) : null}
              </div>
            </Td>
            <Td>
              <RowStatus row={row} />
            </Td>
            <Td className="whitespace-nowrap tabular-nums">
              {row.date
                ? formatDate(
                    row.date.slice(0, 10),
                    { month: "short", day: "numeric" },
                    locale
                  )
                : null}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
