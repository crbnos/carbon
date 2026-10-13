// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  isMigrationClearingZero,
  type MigrationClearingRow
} from "@carbon/database/accounting-cutover";
import { cn, Table, Tbody, Td, Tfoot, Th, Thead, Tr } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useCurrencyFormatter } from "~/hooks";
import { accountLabel, useAccountsById } from "./ActivationSteps";

/**
 * Migration Clearing per control account: what the prior system's trial
 * balance says, what Carbon's open items hold, and the difference. Amounts
 * are debit-signed. Every difference stays on Migration Clearing.
 */
export default function MigrationClearingTable({
  rows,
  total
}: {
  rows: MigrationClearingRow[];
  total: number;
}) {
  const formatter = useCurrencyFormatter();
  const accountsById = useAccountsById();
  // A control account with nothing on either side tells the reader nothing.
  const shown = rows.filter(
    (row) => row.trialBalance !== 0 || row.carbon !== 0
  );

  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Control Account</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Trial Balance</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Carbon</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Difference</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {shown.length === 0 ? (
          <Tr>
            <Td colSpan={4} className="text-center text-muted-foreground">
              <Trans>No control account has a balance at the cutover.</Trans>
            </Td>
          </Tr>
        ) : (
          shown.map((row) => (
            <Tr key={row.accountId}>
              <Td>{accountLabel(accountsById, row.accountId)}</Td>
              <Td className="text-right tabular-nums">
                {formatter.format(row.trialBalance)}
              </Td>
              <Td className="text-right tabular-nums">
                {formatter.format(row.carbon)}
              </Td>
              <Td
                className={cn(
                  "text-right tabular-nums",
                  !isMigrationClearingZero(row.difference) && "text-destructive"
                )}
              >
                {formatter.format(row.difference)}
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
      <Tfoot>
        <Tr>
          <Th colSpan={3}>
            <Trans>Migration Clearing</Trans>
          </Th>
          <Th
            className={cn(
              "text-right tabular-nums",
              !isMigrationClearingZero(total) && "text-destructive"
            )}
          >
            {formatter.format(total)}
          </Th>
        </Tr>
      </Tfoot>
    </Table>
  );
}
