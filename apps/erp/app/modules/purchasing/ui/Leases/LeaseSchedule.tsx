// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { DateTime, Hyperlink } from "~/components";
import { path } from "~/utils/path";
import LeaseMoney from "./LeaseMoney";
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

  const renderTable = (rows: LeaseScheduleLine[]) => (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Month Ending</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Opening Liability</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Payment</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Interest</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Principal</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Closing Liability</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Lease Cost</Trans>
          </Th>
          <Th className="text-right">
            <Trans>ROU Amortization</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Net ROU Asset</Trans>
          </Th>
          <Th>
            <Trans>Status</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((line) => {
          const posted = isScheduleLinePosted(line);
          const journalId =
            line.journalId ??
            line.rows?.find((row) => row.journalId)?.journalId ??
            null;
          const journalEntryId = journalId ? journalById.get(journalId) : null;
          return (
            <Tr key={line.id}>
              <Td>
                <DateTime value={line.periodDate} variant="date" />
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={line.openingLiability}
                  currencyCode={currencyCode}
                />
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={line.paymentAmount}
                  currencyCode={currencyCode}
                />
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={line.interestAmount}
                  currencyCode={currencyCode}
                />
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={line.principalAmount}
                  currencyCode={currencyCode}
                />
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={line.closingLiability}
                  currencyCode={currencyCode}
                />
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={line.leaseCost}
                  currencyCode={currencyCode}
                />
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={line.rouAmortization}
                  currencyCode={currencyCode}
                />
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={line.closingRouAsset}
                  currencyCode={currencyCode}
                />
              </Td>
              <Td>
                {posted ? (
                  journalId ? (
                    <Hyperlink to={path.to.journalEntryDetails(journalId)}>
                      <Status color="green">
                        {journalEntryId ?? <Trans>Posted</Trans>}
                      </Status>
                    </Hyperlink>
                  ) : (
                    <Status color="green">
                      <Trans>Posted</Trans>
                    </Status>
                  )
                ) : (
                  <Status color="gray">
                    <Trans>Planned</Trans>
                  </Status>
                )}
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );

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
                {renderTable(group.rows)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default LeaseSchedule;
