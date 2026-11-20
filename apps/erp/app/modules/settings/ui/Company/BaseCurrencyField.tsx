// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useControlField } from "@carbon/form";
import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import { Boolean, Currency } from "~/components/Form";
import type { BaseCurrencyChangeBlocker } from "~/modules/settings/settings.models";
import type { BaseCurrencyChange } from "~/modules/settings/types";

type BaseCurrencyFieldProps = {
  change: BaseCurrencyChange | null | undefined;
};

// A function declaration, so `plural()` folds into the `t` message.
export function BaseCurrencyField({ change }: BaseCurrencyFieldProps) {
  const { t } = useLingui();
  const [baseCurrencyCode] = useControlField<string>("baseCurrencyCode");

  const blockerLabels: Record<BaseCurrencyChangeBlocker, string> = {
    "ledger-has-amounts": t`The ledger has entries`,
    "has-documents": t`Quotes, orders, invoices or other documents exist`,
    "has-stock-or-costs": t`Stock has been received, moved or used`,
    "has-fixed-assets": t`Fixed assets exist`,
    "group-has-data": t`Another company in the group has transactions`,
    "accounting-integration": t`An accounting or spend integration is connected`
  };

  const blockers = change?.blockers ?? [];
  const fromCode = change?.baseCurrencyCode ?? "";
  const toCode = baseCurrencyCode ?? "";
  const pending =
    change && blockers.length === 0 && toCode && toCode !== fromCode
      ? change
      : null;

  const keptAmounts = pending
    ? pending.itemCosts +
      pending.itemPrices +
      pending.workCenterRates +
      pending.approvalRules
    : 0;
  const records = pending
    ? pending.customers + pending.suppliers + pending.supplierParts
    : 0;
  const keepLabel = t`${plural(records, {
    one: `Keep # customer, supplier or supplier part in ${fromCode}`,
    other: `Keep # customers, suppliers and supplier parts in ${fromCode}`
  })}`;
  const keepDescription = t`Otherwise they move to ${toCode}, and so do bank accounts in ${fromCode}.`;

  return (
    <div className="flex w-full flex-col gap-2">
      <Currency
        name="baseCurrencyCode"
        label={t`Base Currency`}
        isReadOnly={!change || blockers.length > 0}
      />
      {blockers.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <p>
            <Trans>The base currency can't change because:</Trans>
          </p>
          <ul className="list-disc pl-4">
            {blockers.map((blocker) => (
              <li key={blocker}>{blockerLabels[blocker]}</li>
            ))}
          </ul>
        </div>
      )}
      {pending && (
        <Alert variant="warning">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            <Trans>Changing the base currency converts no amounts</Trans>
          </AlertTitle>
          {keptAmounts > 0 && (
            <AlertDescription>
              <p>
                <Trans>Kept as entered and read in {toCode}:</Trans>
              </p>
              <ul className="list-disc pl-4">
                {pending.itemCosts > 0 && (
                  <li>
                    <Plural
                      value={pending.itemCosts}
                      one="# item cost"
                      other="# item costs"
                    />
                  </li>
                )}
                {pending.itemPrices > 0 && (
                  <li>
                    <Plural
                      value={pending.itemPrices}
                      one="# item price"
                      other="# item prices"
                    />
                  </li>
                )}
                {pending.workCenterRates > 0 && (
                  <li>
                    <Plural
                      value={pending.workCenterRates}
                      one="Rates on # work center"
                      other="Rates on # work centers"
                    />
                  </li>
                )}
                {pending.approvalRules > 0 && (
                  <li>
                    <Plural
                      value={pending.approvalRules}
                      one="# approval rule"
                      other="# approval rules"
                    />
                  </li>
                )}
              </ul>
            </AlertDescription>
          )}
        </Alert>
      )}
      {records > 0 && (
        <Boolean
          name="keepRecordCurrencies"
          label={keepLabel}
          description={keepDescription}
        />
      )}
    </div>
  );
}
