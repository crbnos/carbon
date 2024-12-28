import type { CurrencyCode } from "~/modules/accounting";

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

  getMetaData() {
    return {
      apiUrl: this.#apiUrl,
    };
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

  async convertExchangeRates(
    baseCurrencyCode: CurrencyCode,
    rates: Rates
  ): Promise<Rates> {
    /**
     * Convert the EUR-based exchange rates to a different base currency.
     */
    const baseRate = rates[baseCurrencyCode];
    if (!baseRate) throw new Error("Base rate not found");

    const convertedRates = Object.entries(rates).reduce<Rates>(
      (acc, [currency, value]) => {
        return {
          ...acc,
          [currency]: value / baseRate,
        };
      },
      {
        [baseCurrencyCode]: 1,
      }
    );

    return convertedRates;
  }
}

export const getExchangeRatesClient = (
  apiKey?: string,
  apiUrl: string = "https://api.exchangeratesapi.io/v1/latest"
) => {
  return typeof apiKey === "string"
    ? new ExchangeRatesClient({
        apiKey,
        apiUrl,
      })
    : undefined;
};
