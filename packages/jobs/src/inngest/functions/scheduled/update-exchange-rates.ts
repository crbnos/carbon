import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { EXCHANGE_RATES_API_KEY } from "@carbon/env";
import { datetime, round } from "@carbon/utils";
import { inngest } from "../../client";

type CurrencyCode = string;

type Rates = { [key in CurrencyCode]?: number };

type ExchangeRatesSuccessResponse = {
  success: boolean;
  timestamp: number;
  base: CurrencyCode;
  date: string;
  rates: Rates;
};

type ExchangeRatesErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type ExchangeRatesResponse =
  | ExchangeRatesErrorResponse
  | ExchangeRatesSuccessResponse;

/**
 * Fetches the latest exchange rates from the API. For the free tier of the
 * API, we can only fetch the rates with a base currency of EUR.
 */
async function fetchEurRates(
  apiKey: string,
  apiUrl = "https://api.exchangeratesapi.io/v1/latest"
): Promise<Rates> {
  const response = await fetch(`${apiUrl}?access_key=${apiKey}`);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data: ExchangeRatesResponse = await response.json();

  if ("success" in data && data.success === true && data.rates) {
    return data.rates;
  }

  throw new Error("Unrecognized response from exchange rates server");
}

/** Codes retired or redenominated — no live feed quotes them, so their
 * absence is expected and not worth a warning. */
const OBSOLETE_CURRENCY_CODES = new Set([
  "VEF",
  "ZMK",
  "LTL",
  "LVL",
  "HRK",
  "ZWL"
]);

type ExchangeRateRow = {
  currencyCode: string;
  effectiveDate: string;
  rate: number;
  updatedAt: string;
};

/**
 * Anchors the EUR-based feed on USD (rate = units of currencyCode per 1 USD)
 * and partitions the known codes into upsertable rows and stale codes.
 * Throws when the feed has no usable USD quote — a partial payload may
 * succeed on retry.
 */
export function buildExchangeRateRows(
  ratesEur: Rates,
  codes: string[],
  effectiveDate: string,
  updatedAt: string
): { rows: ExchangeRateRow[]; staleCodes: string[] } {
  const usd = Number(ratesEur["USD"]);
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error("USD rate missing from feed, cannot anchor to USD");
  }

  const rows: ExchangeRateRow[] = [];
  const staleCodes: string[] = [];

  for (const code of codes) {
    const feedRate = ratesEur[code];
    // Rates carry internal scale — never the currency's DISPLAY
    // decimals, which zeroed every 0-decimal currency's fraction and
    // silently froze rates that rounded to 0
    const rate =
      feedRate === undefined ? Number.NaN : round(Number(feedRate) / usd);
    if (!Number.isFinite(rate) || rate <= 0) {
      if (!OBSOLETE_CURRENCY_CODES.has(code)) {
        staleCodes.push(code);
      }
      continue;
    }
    rows.push({ currencyCode: code, effectiveDate, rate, updatedAt });
  }

  return { rows, staleCodes };
}

export const updateExchangeRatesFunction = inngest.createFunction(
  { id: "update-exchange-rates", retries: 2 },
  { cron: "0 0 * * *" },
  async ({ step, logger }) => {
    await step.run("fetch-and-update-exchange-rates", async () => {
      if (!EXCHANGE_RATES_API_KEY) {
        logger.info(
          "EXCHANGE_RATES_API_KEY is not configured, skipping exchange rate update"
        );
        return;
      }

      // Fetch the exchange rates once, with the free tier's base currency of EUR
      let ratesEur: Rates;
      try {
        ratesEur = await fetchEurRates(EXCHANGE_RATES_API_KEY);
      } catch (error) {
        logger.error("Error fetching exchange rates", { error });
        throw new Error(
          `Error fetching exchange rates: ${(error as Error).message}`
        );
      }
      logger.info(
        "Successfully fetched exchange rates with base currency EUR",
        {
          currencyCount: Object.keys(ratesEur).length
        }
      );

      const serviceRole = getCarbonServiceRole();

      // Reference table — no tenancy
      const currencyCodes = await serviceRole
        .from("currencyCode")
        .select("code");

      if (currencyCodes.error) {
        logger.error("Error fetching currency codes", {
          error: currencyCodes.error
        });
        throw new Error(
          `Error fetching currency codes: ${currencyCodes.error.message}`
        );
      }

      const updatedAt = datetime.timestamp();
      // The feed is a UTC-day artifact, so the UTC day is the effective date
      const effectiveDate = updatedAt.slice(0, 10);

      const { rows, staleCodes } = buildExchangeRateRows(
        ratesEur,
        (currencyCodes.data ?? []).map(({ code }) => code),
        effectiveDate,
        updatedAt
      );

      if (staleCodes.length > 0) {
        logger.warn(
          "Currency codes absent from the feed (or with unusable rates) — their stored rates are going stale",
          { codes: staleCodes }
        );
      }

      if (rows.length === 0) {
        logger.info("No exchange rates to upsert");
        return;
      }

      const { error: upsertError } = await serviceRole
        .from("exchangeRate")
        .upsert(rows, { onConflict: "currencyCode,effectiveDate" });

      if (upsertError) {
        logger.error("Error upserting exchange rates", { error: upsertError });
        throw new Error(
          `Error upserting exchange rates: ${upsertError.message}`
        );
      }

      logger.info("Exchange rates task completed", {
        count: rows.length,
        effectiveDate
      });
    });
  }
);
