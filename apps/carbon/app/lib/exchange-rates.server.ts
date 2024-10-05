import type { CurrencyCode } from "~/modules/accounting";

type ExchangeClientOptions = {
  apiKey?: string;
  apiUrl: string;
  baseCurrency: CurrencyCode;
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
  #baseCurrency: CurrencyCode;

  constructor(options: ExchangeClientOptions) {
    if (!options.apiKey) throw new Error("EXCHANGE_RATES_API_KEY not set");

    this.#apiKey = options.apiKey;
    this.#apiUrl = options.apiUrl;
    this.#baseCurrency = options.baseCurrency ?? "USD";
  }

  getMetaData() {
    return {
      apiUrl: this.#apiUrl,
      baseCurrency: this.#baseCurrency,
    };
  }

  async getExchangeRates(base?: CurrencyCode): Promise<Rates> {
    const url = `${this.#apiUrl}?access_key=${this.#apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: ExchangeRatesResponse = await response.json();

    if ("success" in data && data.success === true) {
      const baseRate = data.rates[base ?? this.#baseCurrency];
      if (!baseRate) throw new Error("Base rate not found in response");

      const convertedRates = Object.entries(data.rates).reduce<Rates>(
        (acc, [currency, value]) => {
          return {
            ...acc,
            [currency]: value / baseRate,
          };
        },
        {
          [data.base]: 1,
        }
      );

      return convertedRates;
    }

    throw new Error("Unrecognized response from exchange rates server");
  }
}

export const getExchangeRatesClient = (
  apiKey?: string,
  apiUrl: string = "https://api.exchangeratesapi.io/v1/latest",
  baseCurrency: CurrencyCode = "USD"
) => {
  return typeof apiKey === "string"
    ? new ExchangeRatesClient({
        apiKey,
        apiUrl,
        baseCurrency,
      })
    : undefined;
};
