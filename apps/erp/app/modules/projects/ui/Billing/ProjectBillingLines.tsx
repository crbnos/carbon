// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  LabelWithHelp,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import Empty from "~/components/Empty";
import { useCurrencyFormatter, useUser } from "~/hooks";
import { usePercentFormatter } from "~/hooks/usePercentFormatter";
import { FundingBar } from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";
import type { ProjectContractRevenue } from "../../projects.service";
import type { ContractBillingLine } from "../../types";

type Position = { billed: number; unbilled: number; incurred: number };

/**
 * A project's contract billing lines: the contract and line, its billing
 * element and funding, and with `revenue` the percent complete and the
 * revenue recognized to date. A Right to Invoice line has no percent
 * complete. The billing method and the rest of the terms are on the line's
 * own page, which the line name opens.
 */
export default function ProjectBillingLines({
  lines,
  funding,
  revenue
}: {
  lines: ContractBillingLine[];
  funding: Record<string, Position>;
  /** Progress and revenue to date per line (`getProjectContractRevenue`). */
  revenue?: Record<string, ProjectContractRevenue>;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  // Billing lines need the contract currency to be the base currency (P5).
  const currencyCode = company.baseCurrencyCode ?? "USD";
  const formatMoney = useCurrencyFormatter({ currency: currencyCode });
  const formatPercent = usePercentFormatter();
  // A Right to Invoice line has no progress: it recognizes what it bills.
  const formatProgress = (line: ContractBillingLine) => {
    const progress = revenue?.[line.id]?.percentComplete ?? null;
    return line.revenueMethod === "Percent Complete" && progress !== null
      ? formatPercent.format(progress)
      : "—";
  };

  if (lines.length === 0) {
    return (
      <Empty
        className="py-4"
        title={t`No billing lines yet`}
        description={t`Time & Materials and Cost Plus lines show here. Fixed Price lines bill on billing events.`}
      />
    );
  }

  return (
    <div className="min-h-0 overflow-auto rounded-md border border-border">
      <Table full className="table-fixed">
        <Thead>
          <Tr>
            <Th>
              <Trans>Line</Trans>
            </Th>
            <Th>
              <LabelWithHelp termId="billing-element" variant="inline">
                <Trans>Billing Element</Trans>
              </LabelWithHelp>
            </Th>
            <Th className="w-40">
              <Trans>Funding</Trans>
            </Th>
            {revenue && (
              <Th className="w-28 whitespace-nowrap text-right">
                <Trans>Progress</Trans>
              </Th>
            )}
            {revenue && (
              <Th className="w-32 whitespace-nowrap text-right">
                <Trans>Revenue</Trans>
              </Th>
            )}
          </Tr>
        </Thead>
        <Tbody>
          {lines.map((line) => (
            <Tr key={line.id}>
              <Td className="max-w-0">
                <LineName line={line} />
              </Td>
              <Td className="max-w-0">
                {line.element ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 whitespace-nowrap font-medium">
                      {line.element.readableId}
                    </span>
                    <span className="truncate">{line.element.name}</span>
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <FundingBar
                  position={
                    funding[line.id] ?? { billed: 0, unbilled: 0, incurred: 0 }
                  }
                  terms={line}
                  currencyCode={currencyCode}
                  compact
                />
              </Td>
              {revenue && (
                <Td className="text-right tabular-nums">
                  {formatProgress(line)}
                </Td>
              )}
              {revenue && (
                <Td className="text-right tabular-nums">
                  {formatMoney.format(revenue[line.id]?.recognizedToDate ?? 0)}
                </Td>
              )}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}

/** The contract id, then the line's name on one line; a long name ends in an
 *  ellipsis and shows whole in a tooltip. */
function LineName({ line }: { line: ContractBillingLine }) {
  const name = line.description || line.item?.name || line.id;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
        {line.contract?.customerContractId ?? "—"}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={path.to.contractLineBilling(line.customerContractId, line.id)}
            className="min-w-0 truncate font-medium hover:underline"
          >
            {name}
          </Link>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
    </span>
  );
}
