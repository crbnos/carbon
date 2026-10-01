// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { NumberField, NumberInput, Subheading, toast } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { Hidden } from "~/components/Form";
import { useCurrencyDecimals, useUser } from "~/hooks";
import type { ConfigurationParameter } from "~/modules/items/types";
import type { PricingRuleConfigurationPrice } from "../../types";

// Parameter types a price can be attached to: a list option, a boolean when
// true, or a numeric value per unit.
const PRICEABLE_TYPES = ["list", "boolean", "numeric"] as const;

type PriceRow = { value: string | null; label: string };

function priceRows(
  parameter: ConfigurationParameter,
  labels: { yes: string; perUnit: string }
) {
  switch (parameter.dataType) {
    case "list":
      return (parameter.listOptions ?? []).map<PriceRow>((option) => ({
        value: option,
        label: option
      }));
    case "boolean":
      return [{ value: "true", label: labels.yes }];
    case "numeric":
      return [{ value: null, label: labels.perUnit }];
    default:
      return [];
  }
}

const priceKey = (key: string, value: string | null) =>
  `${key}\u0000${value ?? ""}`;

const toAmounts = (prices: PricingRuleConfigurationPrice[]) =>
  new Map(
    prices.map((price) => [priceKey(price.key, price.value), price.amount])
  );

type PricingRuleConfigurationPricesProps = {
  itemId: string | null;
  // The item the stored prices belong to (the rule's item when it was loaded).
  initialItemId: string | null;
  initialPrices: PricingRuleConfigurationPrice[];
};

/**
 * Per-parameter surcharges of a Configuration rule, for its one configurable
 * item. Must be rendered inside the pricing rule's ValidatedForm.
 */
const PricingRuleConfigurationPrices = ({
  itemId,
  initialItemId,
  initialPrices
}: PricingRuleConfigurationPricesProps) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(baseCurrency);

  const [parameters, setParameters] = useState<ConfigurationParameter[]>([]);
  // The item the parameters were loaded for. Until they load, the stored
  // prices of the rule's own item are posted untouched, so a quick save (or a
  // failed load) cannot drop them.
  const [loadedItemId, setLoadedItemId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState(() => toAmounts(initialPrices));

  // Prices are keyed by one item's parameters: another item starts from an
  // empty price list, and switching back restores the stored prices.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the item changes
  useEffect(() => {
    setAmounts(itemId === initialItemId ? toAmounts(initialPrices) : new Map());
  }, [itemId]);

  useEffect(() => {
    if (!itemId || !carbon || !company?.id) {
      setParameters([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const result = await carbon
        .from("configurationParameter")
        .select("*")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .in("dataType", [...PRICEABLE_TYPES])
        .order("sortOrder", { ascending: true });

      if (cancelled) return;
      if (result.error) {
        toast.error(t`Failed to load configuration parameters`);
        setParameters([]);
        return;
      }
      setParameters(result.data ?? []);
      setLoadedItemId(itemId);
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId, carbon, company?.id, t]);

  const yes = t`Yes`;
  const perUnit = t`Per unit`;
  const rowsByParameter = useMemo(
    () =>
      parameters.map((parameter) => ({
        parameter,
        rows: priceRows(parameter, { yes, perUnit })
      })),
    [parameters, yes, perUnit]
  );

  const isLoading = itemId !== null && loadedItemId !== itemId;

  const prices = useMemo(() => {
    if (isLoading) return itemId === initialItemId ? initialPrices : [];
    const result: PricingRuleConfigurationPrice[] = [];
    for (const { parameter, rows } of rowsByParameter) {
      for (const row of rows) {
        const amount = amounts.get(priceKey(parameter.key, row.value));
        if (amount) {
          result.push({
            key: parameter.key,
            value: row.value,
            amount,
            label: parameter.label
          });
        }
      }
    }
    return result;
  }, [
    isLoading,
    itemId,
    initialItemId,
    initialPrices,
    rowsByParameter,
    amounts
  ]);

  const setAmount = (key: string, value: string | null, amount: number) => {
    setAmounts((current) => {
      const next = new Map(current);
      next.set(priceKey(key, value), Number.isFinite(amount) ? amount : 0);
      return next;
    });
  };

  return (
    <>
      <Hidden name="configurationPrices" value={JSON.stringify(prices)} />
      {!isLoading && rowsByParameter.length > 0 && (
        <div className="flex flex-col gap-3 w-full">
          <div className="flex flex-col gap-1">
            <Subheading as="h3">
              <Trans>Configuration Prices</Trans>
            </Subheading>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Added to the unit price for the chosen values, before discounts
                and markups. Use a negative amount for a credit.
              </Trans>
            </p>
          </div>
          {rowsByParameter.map(({ parameter, rows }) => (
            <div
              key={parameter.id}
              className="flex flex-col gap-2 w-full rounded-md border border-border p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{parameter.label}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {parameter.key}
                </span>
              </div>
              {rows.map((row) => (
                <div
                  key={row.value ?? "per-unit"}
                  className="grid grid-cols-2 items-center gap-3"
                >
                  <span className="text-sm text-muted-foreground truncate">
                    {row.label}
                  </span>
                  <NumberField
                    aria-label={`${parameter.label} ${row.label}`}
                    value={amounts.get(priceKey(parameter.key, row.value)) ?? 0}
                    onChange={(amount) =>
                      setAmount(parameter.key, row.value, amount)
                    }
                    step={INPUT_STEP.rate}
                    formatOptions={INPUT_FORMAT.rate(
                      baseCurrency,
                      currencyDecimals
                    )}
                  >
                    <NumberInput size="sm" />
                  </NumberField>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default PricingRuleConfigurationPrices;
