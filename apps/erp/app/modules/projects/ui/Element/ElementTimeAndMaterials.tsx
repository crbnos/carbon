// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { EmployeeAvatar } from "~/components";
import {
  useCurrencyFormatter,
  useDateFormatter,
  useQuantityFormatter
} from "~/hooks";
import type {
  ProjectCostType,
  TimesheetEntryStatus as TimesheetEntryStatusType
} from "../../projects.models";
import type {
  ElementLedgerRow,
  ElementOpenTimeRow
} from "../../projects.server";
import { OpenTimeAction } from "./OpenTimeAction";
import { TimesheetEntryStatus } from "./TimesheetEntryStatus";

/**
 * The project ledger rows of an element and its descendants, and their
 * timesheet entries that are not Posted yet (Posted time is in the ledger).
 */
export function ElementTimeAndMaterials({
  ledger,
  openTime
}: {
  ledger: ElementLedgerRow[];
  openTime: ElementOpenTimeRow[];
}) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  const costTypeLabels: Record<ProjectCostType, string> = {
    Material: t`Material`,
    Labor: t`Labor`,
    Machine: t`Machine`,
    Overhead: t`Overhead`,
    "Outside Processing": t`Outside Processing`,
    "Purchased Service": t`Purchased Service`,
    "Other Direct": t`Other Direct`,
    "Material Variance": t`Material Variance`,
    "Payback Variance": t`Payback Variance`,
    Burden: t`Burden`
  };

  return (
    <VStack spacing={4} className="w-full">
      {ledger.length > 0 && (
        <div className="w-full">
          <div className="w-full overflow-x-auto rounded-md border border-border">
            <TableBase full>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Date</Trans>
                  </Th>
                  <Th>
                    <Trans>Type</Trans>
                  </Th>
                  <Th>
                    <Trans>Document</Trans>
                  </Th>
                  <Th>
                    <Trans>Quantity</Trans>
                  </Th>
                  <Th>
                    <Trans>Amount</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {ledger.map((row) => (
                  <Tr key={row.id}>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatDate(row.postingDate)}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {costTypeLabels[row.costType as ProjectCostType] ??
                        row.costType}
                    </Td>
                    <Td>
                      <div className="flex max-w-[220px] flex-col">
                        <span className="truncate">{row.documentType}</span>
                        {row.readableId && (
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {row.readableId}
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {row.quantity === null
                        ? "—"
                        : `${formatQuantity(row.quantity)} ${row.unitOfMeasureCode ?? ""}`}
                    </Td>
                    <Td className="tabular-nums">
                      {formatMoney.format(row.amount)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </TableBase>
          </div>
        </div>
      )}

      {openTime.length > 0 && (
        <div className="w-full">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            <Trans>Time not posted yet</Trans>
          </span>
          <div className="w-full overflow-x-auto rounded-md border border-border">
            <TableBase full>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Date</Trans>
                  </Th>
                  <Th>
                    <Trans>Employee</Trans>
                  </Th>
                  <Th>
                    <Trans>Hours</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <span className="sr-only">
                      <Trans>Next step</Trans>
                    </span>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {openTime.map((row) => (
                  <Tr key={row.id}>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatDate(row.entryDate)}
                    </Td>
                    <Td>
                      <EmployeeAvatar employeeId={row.employeeId} size="xxs" />
                    </Td>
                    <Td className="tabular-nums">
                      {formatQuantity(row.hours)}
                    </Td>
                    <Td>
                      <TimesheetEntryStatus
                        status={row.status as TimesheetEntryStatusType}
                      />
                    </Td>
                    <Td className="text-right">
                      <OpenTimeAction entry={row} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </TableBase>
          </div>
        </div>
      )}
    </VStack>
  );
}
