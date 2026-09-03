import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { EXCHANGE_RATES_API_KEY } from "@carbon/env";
import { datetime, round } from "@carbon/utils";
import { inngest } from "../../client";

type CurrencyCode = string;

type ExchangeClientOptions = {
  apiKey?: string;
  apiUrl: string;
};

export type Rates = { [key in CurrencyCode]?: number };

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

export class ExchangeRatesClient {
  #apiKey: string;
  #apiUrl: string;

  constructor(options: ExchangeClientOptions) {
    if (!options.apiKey) throw new Error("EXCHANGE_RATES_API_KEY not set");

    this.#apiKey = options.apiKey;
    this.#apiUrl = options.apiUrl;
  }

  async getExchangeRates(): Promise<Rates> {
    /**
     * Fetches the latest exchange rates from the API. For the free tier of the API, we can only fetch
     * the rates with a base currency of EUR.
     */
    const url = `${this.#apiUrl}?access_key=${this.#apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: ExchangeRatesResponse = await response.json();

    if ("success" in data && data.success === true) {
      return data.rates;
    }

    throw new Error("Unrecognized response from exchange rates server");
  }
}

export const getExchangeRatesClient = (
  apiKey?: string,
  apiUrl: string = "https://api.exchangeratesapi.io/v1/latest"
) => {
  return typeof apiKey === "string"
    ? new ExchangeRatesClient({
        apiKey,
        apiUrl
      })
    : undefined;
};

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

      const exchangeRatesClient = getExchangeRatesClient(
        EXCHANGE_RATES_API_KEY
      );
      if (!exchangeRatesClient) {
        logger.info(
          "Exchange rates client is undefined, skipping exchange rate update"
        );
        return;
      }

      // Fetch the exchange rates once, with the free tier's base currency of EUR
      let ratesEUR: Rates;
      try {
        ratesEUR = await exchangeRatesClient.getExchangeRates();
        if (!ratesEUR)
          throw new Error("No rates returned from exchange rates API");
        logger.info(
          "Successfully fetched exchange rates with base currency EUR",
          {
            currencyCount: Object.keys(ratesEUR).length
          }
        );
      } catch (error) {
        logger.error("Error fetching exchange rates", { error });
        return;
      }

      // The global store anchors on USD: rate = units of currencyCode per 1 USD
      const usdRate = ratesEUR["USD"];
      if (!usdRate) {
        logger.error("USD rate missing from feed, cannot anchor to USD");
        return;
      }

      const serviceRole = getCarbonServiceRole();

      // Reference table — no tenancy
      const currencyCodes = await serviceRole
        .from("currencyCode")
        .select("code");

      if (currencyCodes.error) {
        logger.error("Error fetching currency codes", {
          error: currencyCodes.error
        });
        return;
      }

      const updatedAt = datetime.timestamp();
      // The feed is a UTC-day artifact, so the UTC day is the effective date
      const effectiveDate = updatedAt.slice(0, 10);

      const staleCodes: string[] = [];
      const rows: {
        currencyCode: string;
        effectiveDate: string;
        rate: number;
        updatedAt: string;
      }[] = [];

      for (const { code } of currencyCodes.data ?? []) {
        const feedRate = ratesEUR[code];
        // Rates carry internal scale — never the currency's DISPLAY
        // decimals, which zeroed every 0-decimal currency's fraction and
        // silently froze rates that rounded to 0
        const rate =
          feedRate === undefined
            ? Number.NaN
            : round(Number(feedRate) / usdRate);
        if (!Number.isFinite(rate) || rate <= 0) {
          staleCodes.push(code);
          continue;
        }
        rows.push({ currencyCode: code, effectiveDate, rate, updatedAt });
      }

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
        return;
      }

      logger.info("Exchange rates task completed", {
        count: rows.length,
        effectiveDate
      });
    });
  }
);
