// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { DateTime, Hyperlink } from "~/components";
import Money from "~/components/Money";
import { path } from "~/utils/path";
import type {
  Lease,
  LeaseJournal,
  LeaseLine,
  LeaseScheduleLine
} from "./types";
import { isScheduleLinePosted } from "./utils";

type LeaseScheduleProps = {
  lease: Lease;
  lines: LeaseLine[];
  schedule: LeaseScheduleLine[];
  journals: LeaseJournal[];
};

/** The monthly effective-interest schedule activation wrote for each asset,
 *  each month with whether its lease run has posted. */
const LeaseSchedule = ({
  lease,
  lines,
  schedule,
  journals
}: LeaseScheduleProps) => {
  const currencyCode = lease.currencyCode;
  const journalById = new Map(
    journals.map((journal) => [journal.id, journal.journalEntryId])
  );
  const groups = lines
    .map((line) => ({
      line,
      rows: schedule.filter((row) => row.leaseLineId === line.id)
    }))
    .filter((group) => group.rows.length > 0);
  const severalAssets = groups.length > 1;
  const allShortTerm =
    lines.length > 0 &&
    lines.every((line) => line.lesseeClassification === "Short-Term");

  // Principal is the payment less the interest, and a finance asset's lease
  // cost is its interest plus amortization, so only an operating asset — whose
  // straight-line cost is its own figure — shows a Lease Cost column.
  const renderTable = (line: LeaseLine, rows: LeaseScheduleLine[]) => {
    const isOperating = line.lesseeClassification === "Operating";
    return (
      <Table>
        <Thead>
          <Tr>
            <Th className="whitespace-nowrap">
              <Trans>Month Ending</Trans>
            </Th>
            <Th className="text-right whitespace-nowrap">
              <Trans>Payment</Trans>
            </Th>
            <Th className="text-right whitespace-nowrap">
              <Trans>Interest</Trans>
            </Th>
            <Th className="text-right whitespace-nowrap">
              <Trans>Liability</Trans>
            </Th>
            {isOperating && (
              <Th className="text-right whitespace-nowrap">
                <Trans>Lease Cost</Trans>
              </Th>
            )}
            <Th className="text-right whitespace-nowrap">
              <Trans>ROU Amortization</Trans>
            </Th>
            <Th className="text-right whitespace-nowrap">
              <Trans>ROU Asset</Trans>
            </Th>
            <Th className="whitespace-nowrap">
              <Trans>Status</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row) => {
            const posted = isScheduleLinePosted(row);
            const journalId =
              row.journalId ??
              row.rows?.find((run) => run.journalId)?.journalId ??
              null;
            const journalEntryId = journalId
              ? journalById.get(journalId)
              : null;
            return (
              <Tr key={row.id}>
                <Td className="whitespace-nowrap">
                  <DateTime value={row.periodDate} variant="date" />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Money
                    value={row.paymentAmount}
                    currencyCode={currencyCode}
                  />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Money
                    value={row.interestAmount}
                    currencyCode={currencyCode}
                  />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Money
                    value={row.closingLiability}
                    currencyCode={currencyCode}
                  />
                </Td>
                {isOperating && (
                  <Td className="text-right whitespace-nowrap">
                    <Money value={row.leaseCost} currencyCode={currencyCode} />
                  </Td>
                )}
                <Td className="text-right whitespace-nowrap">
                  <Money
                    value={row.rouAmortization}
                    currencyCode={currencyCode}
                  />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Money
                    value={row.closingRouAsset}
                    currencyCode={currencyCode}
                  />
                </Td>
                <Td className="whitespace-nowrap">
                  {journalId ? (
                    <Hyperlink to={path.to.journalEntryDetails(journalId)}>
                      <span title={journalEntryId ?? undefined}>
                        <Trans>Posted</Trans>
                      </span>
                    </Hyperlink>
                  ) : posted ? (
                    <Trans>Posted</Trans>
                  ) : (
                    <span className="text-muted-foreground">
                      <Trans>Planned</Trans>
                    </span>
                  )}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Schedule</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Each month the lease run posts each asset's interest and
            right-of-use amortization.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {lease.status === "Draft" ? (
              <Trans>
                The schedule is written when the lease is activated.
              </Trans>
            ) : allShortTerm ? (
              <Trans>
                A short-term lease has no schedule. Each invoice is expensed.
              </Trans>
            ) : (
              <Trans>No schedule lines.</Trans>
            )}
          </p>
        ) : (
          <div className="flex w-full flex-col gap-6">
            {groups.map((group) => (
              <div key={group.line.id} className="flex flex-col gap-2">
                {severalAssets && (
                  <h4 className="text-sm font-medium">
                    {group.line.description}
                  </h4>
                )}
                {renderTable(group.line, group.rows)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default LeaseSchedule;
