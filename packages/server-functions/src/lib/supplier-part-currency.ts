// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import {
  type CurrencyRate,
  convertUnitPrice,
  supplierPartCurrency
} from "@carbon/database/supplier-part-price";
import { type Kysely, sql } from "kysely";

export type SupplierPartPriceConverter = {
  /** The currency a supplier part's price is in (NULL = base). */
  currencyOf: (partCurrencyCode: string | null) => string;
  /** A price per purchase unit in the DOCUMENT's currency, in the part's. */
  toPartCurrency: (price: number, partCurrencyCode: string | null) => number;
};

/**
 * Converts prices learned from a purchase document (a supplier quote, order or
 * invoice) into the currency of the supplier part that records them. A part
 * keeps the currency it was set up in; a price in that same currency is copied
 * exactly, any other crosses through base at the document's own rate and the
 * part currency's CURRENT rate. A missing rate raises (`get_exchange_rate`)
 * rather than recording the price at par.
 *
 * A NULL document or part currency is the company base currency. Rates are
 * loaded once, for every part currency the caller will convert into.
 */
export async function getSupplierPartPriceConverter(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  document: { currencyCode: string | null; exchangeRate: number },
  partCurrencyCodes: (string | null)[]
): Promise<SupplierPartPriceConverter> {
  const company = await db
    .selectFrom("company")
    .select("baseCurrencyCode")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const baseCurrencyCode = company.baseCurrencyCode;

  const currencyOf = (code: string | null) =>
    supplierPartCurrency(code, baseCurrencyCode);
  const from: CurrencyRate = {
    currencyCode: currencyOf(document.currencyCode),
    exchangeRate: document.exchangeRate
  };

  const codes = [
    ...new Set(
      partCurrencyCodes
        .map(currencyOf)
        .filter((code) => code !== from.currencyCode)
    )
  ];

  const rates = new Map<string, number>();
  if (codes.length > 0) {
    const { rows } = await sql<{ code: string; rate: number }>`
      SELECT code, get_exchange_rate(${companyId}, code) AS rate
      FROM unnest(${codes}::text[]) AS code
    `.execute(db);
    for (const row of rows) rates.set(row.code, Number(row.rate));
  }

  return {
    currencyOf,
    toPartCurrency: (price, partCurrencyCode) => {
      const currencyCode = currencyOf(partCurrencyCode);
      return convertUnitPrice(price, from, {
        currencyCode,
        exchangeRate:
          currencyCode === from.currencyCode
            ? from.exchangeRate
            : rates.get(currencyCode)!
      });
    }
  };
}
