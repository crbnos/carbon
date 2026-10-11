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
import type { Lease, LeaseJournal, LeaseScheduleLine } from "./types";
import { isScheduleLinePosted } from "./utils";

type LeaseScheduleProps = {
  lease: Lease;
  schedule: LeaseScheduleLine[];
  journals: LeaseJournal[];
};

/** The monthly effective-interest schedule activation wrote, each month
 *  with whether its lease run has posted. */
const LeaseSchedule = ({ lease, schedule, journals }: LeaseScheduleProps) => {
  const currencyCode = lease.currencyCode;
  const journalById = new Map(
    journals.map((journal) => [journal.id, journal.journalEntryId])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Schedule</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Each month the lease run posts the interest and the right-of-use
            amortization.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {lease.status === "Draft" ? (
              <Trans>
                The schedule is written when the lease is activated.
              </Trans>
            ) : lease.lesseeClassification === "Short-Term" ? (
              <Trans>
                A short-term lease has no schedule. Each invoice is expensed.
              </Trans>
            ) : (
              <Trans>No schedule lines.</Trans>
            )}
          </p>
        ) : (
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
              {schedule.map((line) => {
                const posted = isScheduleLinePosted(line);
                const journalId =
                  line.journalId ??
                  line.rows?.find((row) => row.journalId)?.journalId ??
                  null;
                const journalEntryId = journalId
                  ? journalById.get(journalId)
                  : null;
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
                          <Hyperlink
                            to={path.to.journalEntryDetails(journalId)}
                          >
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
        )}
      </CardContent>
    </Card>
  );
};

export default LeaseSchedule;
