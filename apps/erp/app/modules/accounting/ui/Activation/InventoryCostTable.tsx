// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CutoverInventoryAccountValue,
  CutoverInventoryValuedItem
} from "@carbon/database/accounting-cutover-reads";
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
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { itemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { accountLabel, useAccountsById } from "./ActivationSteps";

/**
 * Per item, the on-hand quantity at the cutover and the unit cost the enable
 * resets its stock to, then the opening value per inventory account. The
 * values come from the server (`getCutoverInventoryValuation`), valued as the
 * opening journal values them. Only an Average item's cost comes from
 * `itemCost`, so only that cost is editable here: a FIFO or LIFO item's cost is
 * replayed from its cost layers, and a Standard item uses its standard cost.
 */
export default function InventoryCostTable({
  items,
  accounts,
  total
}: {
  items: CutoverInventoryValuedItem[];
  accounts: CutoverInventoryAccountValue[];
  total: number;
}) {
  const formatter = useCurrencyFormatter();
  const accountsById = useAccountsById();

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
          {accounts.map((account) => (
            <Tr key={account.accountId}>
              <Td>{accountLabel(accountsById, account.accountId)}</Td>
              <Td className="text-right tabular-nums">
                {formatter.format(account.value)}
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

/** Whether an item type has a details page to link to. */
function isLinkableItemType(type: string): type is (typeof itemType)[number] {
  return (itemType as readonly string[]).includes(type);
}

function InventoryCostRow({ item }: { item: CutoverInventoryValuedItem }) {
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

  const costingMethodLabels: Record<string, string> = {
    Standard: t`Standard`,
    Average: t`Average`,
    FIFO: t`FIFO`,
    LIFO: t`LIFO`
  };
  const isAverage = item.costingMethod === "Average";
  // The cost is saved on the item, so it takes the permission to edit parts.
  const canEditCost = permissions.can("update", "parts");
  const linkType = isLinkableItemType(item.type) ? item.type : null;

  return (
    <Tr>
      <Td>
        <div className="flex flex-col">
          {linkType && permissions.can("view", "parts") ? (
            <Link
              to={getLinkToItemDetails(linkType, item.itemId)}
              className="font-medium text-primary hover:underline"
            >
              {item.readableId}
            </Link>
          ) : (
            <span className="font-medium">{item.readableId}</span>
          )}
          <span className="text-xs text-muted-foreground">{item.name}</span>
        </div>
      </Td>
      <Td>{costingMethodLabels[item.costingMethod] ?? item.costingMethod}</Td>
      <Td className="text-right tabular-nums">
        {formatQuantity(item.quantity)}
      </Td>
      <Td className="text-right">
        {isAverage && canEditCost ? (
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
            isDisabled={save.isPending}
            onChange={(value) => {
              if (!Number.isFinite(value) || value === item.unitCost) return;
              save.submit(
                { unitCost: String(value) },
                { method: "post", action: path.to.itemCostUpdate(item.itemId) }
              );
            }}
          >
            <NumberInput size="sm" className="h-7 text-right tabular-nums" />
          </NumberField>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="tabular-nums">
                {rateFormatter.format(item.unitCost)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isAverage ? (
                <Trans>
                  The average cost of the item. Changing it needs permission to
                  edit parts.
                </Trans>
              ) : item.costingMethod === "Standard" ? (
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
        {formatter.format(item.value)}
      </Td>
    </Tr>
  );
}
