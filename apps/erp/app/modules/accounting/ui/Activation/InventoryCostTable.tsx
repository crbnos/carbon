// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  toast
} from "@carbon/react";
import { EPSILON, INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import type { CutoverInventoryItem } from "~/modules/accounting/accounting.server";
import { path } from "~/utils/path";
import { accountLabel, useAccountsById } from "./ActivationSteps";

/** The value the opening journal gives an item: on-hand × unit cost. Items
 *  with no stock on hand open with no value, as in `getCutoverOpeningInputs`. */
function openingValue(item: CutoverInventoryItem) {
  return item.quantity > EPSILON ? round(item.quantity * item.unitCost) : 0;
}

/**
 * Per item, the on-hand quantity at the cutover and the unit cost the enable
 * resets its stock to. Only an Average item's cost comes from `itemCost`, so
 * only that cost is editable here: a FIFO or LIFO item's cost is replayed from
 * its cost layers, and a Standard item uses its standard cost.
 */
export default function InventoryCostTable({
  items
}: {
  items: CutoverInventoryItem[];
}) {
  const formatter = useCurrencyFormatter();
  const accountsById = useAccountsById();

  const totals = useMemo(() => {
    const byAccount = new Map<string, number>();
    for (const item of items) {
      const value = openingValue(item);
      if (value === 0) continue;
      byAccount.set(
        item.inventoryAccountId,
        (byAccount.get(item.inventoryAccountId) ?? 0) + value
      );
    }
    return [...byAccount].map(([accountId, value]) => ({
      accountId,
      value: round(value)
    }));
  }, [items]);

  const total = round(totals.reduce((sum, row) => sum + row.value, 0));

  return (
    <div className="flex w-full flex-col gap-8">
      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Item</Trans>
            </Th>
            <Th>
              <Trans>Costing Method</Trans>
            </Th>
            <Th className="text-right">
              <Trans>On Hand</Trans>
            </Th>
            <Th className="w-48 text-right">
              <Trans>Unit Cost</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Value</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {items.length === 0 ? (
            <Tr>
              <Td colSpan={5} className="text-center text-muted-foreground">
                <Trans>No item has stock on hand at the cutover date.</Trans>
              </Td>
            </Tr>
          ) : (
            items.map((item) => (
              <InventoryCostRow key={item.itemId} item={item} />
            ))
          )}
        </Tbody>
      </Table>

      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Inventory Account</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Opening Value</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {totals.map((row) => (
            <Tr key={row.accountId}>
              <Td>{accountLabel(accountsById, row.accountId)}</Td>
              <Td className="text-right tabular-nums">
                {formatter.format(row.value)}
              </Td>
            </Tr>
          ))}
        </Tbody>
        <Tfoot>
          <Tr>
            <Th>
              <Trans>Total</Trans>
            </Th>
            <Th className="text-right tabular-nums">
              {formatter.format(total)}
            </Th>
          </Tr>
        </Tfoot>
      </Table>
    </div>
  );
}

function InventoryCostRow({ item }: { item: CutoverInventoryItem }) {
  const { t } = useLingui();
  const formatter = useCurrencyFormatter();
  const rateFormatter = useCurrencyFormatter({ rate: true });
  const formatQuantity = useQuantityFormatter();
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(company.baseCurrencyCode);
  const permissions = usePermissions();

  const save = useAction<{ error: string | null }>({
    onError: (result) => toast.error(result.error ?? t`Failed to save the cost`)
  });

  const isEditable = item.costingMethod === "Average";

  return (
    <Tr>
      <Td>
        <div className="flex flex-col">
          <span className="font-medium">{item.readableId}</span>
          <span className="text-xs text-muted-foreground">{item.name}</span>
        </div>
      </Td>
      <Td>{item.costingMethod}</Td>
      <Td className="text-right tabular-nums">
        {formatQuantity(item.quantity)}
      </Td>
      <Td className="text-right">
        {isEditable ? (
          <NumberField
            // A saved cost reloads the row; the new value remounts the input.
            key={`${item.itemId}:${item.unitCost}`}
            aria-label={t`Unit cost for ${item.readableId}`}
            defaultValue={item.unitCost}
            minValue={0}
            step={INPUT_STEP.rate}
            formatOptions={INPUT_FORMAT.rate(
              company.baseCurrencyCode,
              currencyDecimals
            )}
            isDisabled={!permissions.can("update", "parts") || save.isPending}
            onChange={(value) => {
              if (!Number.isFinite(value) || value === item.unitCost) return;
              save.submit(
                { unitCost: String(value) },
                { method: "post", action: path.to.itemCostUpdate(item.itemId) }
              );
            }}
          >
            <NumberInput
              size="sm"
              className="h-7 text-right font-mono tabular-nums"
            />
          </NumberField>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="tabular-nums">
                {rateFormatter.format(item.unitCost)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {item.costingMethod === "Standard" ? (
                <Trans>The standard cost of the item.</Trans>
              ) : (
                <Trans>
                  The value of the cost layers dated before the cutover.
                </Trans>
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </Td>
      <Td className="text-right tabular-nums">
        {formatter.format(openingValue(item))}
      </Td>
    </Tr>
  );
}
