import { EXCHANGE_RATES_API_KEY, getCarbonServiceRole } from "@carbon/auth";
import type { Rates } from "@carbon/ee/exchange-rates.server";
import { getExchangeRatesClient } from "@carbon/ee/exchange-rates.server";
import { schedules } from "@trigger.dev/sdk/v3";

type CurrencyCode =
  | "EUR"
  | "USD"
  | "GBP"
  | "JPY"
  | "CHF"
  | "CAD"
  | "AUD"
  | "CNY"
  | "INR"
  | "MXN"
  | "BRL"
  | "RUB"
  | "ZAR"
  | "TRY"
  | "SEK"
  | "NOK"
  | "DKK"
  | "SGD"
  | "HKD"
  | "TWD"
  | "THB"
  | "MYR"
  | "PHP"
  | "IDR"
  | "VND"
  | "KRW"
  | "TND"
  | "MAD"
  | "AED"
  | "SAR"
  | "QAR"
  | "KWD"
  | "BHD"
  | "OMR"
  | "JOD"
  | "LYD"
  | "EGP"
  | "ILS"
  | "KZT"
  | "KGS"
  | "UZS"
  | "TJS"
  | "AZN"
  | "TMT"
  | "UYU"
  | "BYN"
  | "KZT"
  | "KGS"
  | "UZS"
  | "TJS"
  | "AZN"
  | "TMT"
  | "UYU"
  | "BYN"
  | "KZT"
  | "KGS"
  | "UZS"
  | "TJS"
  | "AZN"
  | "TMT"
  | "UYU"
  | "BYN";

const serviceRole = getCarbonServiceRole();

export const updateExchangeRates = schedules.task({
  id: "update-exchange-rates",
  cron: "0 0 * * *",
  run: async () => {
    console.log(`💵 Exchange Rates Task Started: ${new Date().toISOString()}`);
    const integrations = await serviceRole
      .from("companyIntegration")
      .select("active, companyId")
      .eq("id", "exchange-rates-v1")
      .eq("active", true);

    if (integrations.error) {
      console.error(
        `Error fetching integrations: ${JSON.stringify(integrations.error)}`
      );
      return;
    }

    if (integrations.data?.length === 0) {
      console.log("No active exchange rate integrations found. Exiting task.");
      return;
    }

    console.log(`Found ${integrations.data.length} active integrations`);

    // Fetch the exchange rates for the base currency of EUR
    const exchangeRatesClient = getExchangeRatesClient(EXCHANGE_RATES_API_KEY);

    if (!exchangeRatesClient) {
      console.error(
        "Exchange rates client is undefined. Check API key configuration."
      );
      return;
    }

    let ratesEUR: Rates;
    try {
      ratesEUR = await exchangeRatesClient.getExchangeRates();
      if (!ratesEUR)
        throw new Error("No rates returned from exchange rates API");
      console.log(
        `Successfully fetched exchange rates with base currency of EUR for ${
          Object.keys(ratesEUR).length
        } currencies`
      );
    } catch (error) {
      console.error(
        `Error fetching exchange rates: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    // Cache the rates for each currency to avoid unnecessary computations
    let cachedRates: { [key in CurrencyCode]?: Rates } = {
      EUR: ratesEUR,
    };

    for (const integration of integrations.data) {
      console.log(
        `Processing integration for company ID: ${integration.companyId}`
      );

      const company = await serviceRole
        .from("company")
        .select("*")
        .eq("id", integration.companyId)
        .single();

      if (company.error) {
        console.error(
          `Error fetching company ${integration.companyId}: ${JSON.stringify(
            company.error
          )}`
        );
        continue;
      }

      const baseCurrencyCode = company.data.baseCurrencyCode as CurrencyCode;
      let rates: Rates | undefined;
      rates = cachedRates[baseCurrencyCode];
      // Check if the rates for this base currency are cached, and if not compute them
      if (rates) {
        console.log(`Using cached rates for ${baseCurrencyCode}`);
      } else {
        console.log(`Computing rates for ${baseCurrencyCode}`);
        rates = await exchangeRatesClient.convertExchangeRates(
          baseCurrencyCode,
          ratesEUR
        );
        cachedRates[baseCurrencyCode] = rates;
      }

      const updatedAt = new Date().toISOString();

      try {
        const { data, error } = await serviceRole
          .from("currency")
          .select("*")
          .eq("companyId", integration.companyId);

        if (error) {
          console.error(
            `Error fetching currencies for company ${
              integration.companyId
            }: ${JSON.stringify(error)}`
          );
          continue;
        }

        if (!data || data.length === 0) {
          console.log(
            `No currencies found for company ${integration.companyId}`
          );
          continue;
        }

        const updates = data
          .map((currency) => ({
            ...currency,
            exchangeRate: Number(
              rates[currency.code as CurrencyCode]?.toFixed(
                currency.decimalPlaces
              )
            ),
            updatedAt,
          }))
          .filter((currency) => currency.exchangeRate);

        if (updates.length === 0) {
          console.log(
            `No currency updates needed for company ${integration.companyId}`
          );
          continue;
        }

        console.log(
          `Updating ${updates.length} currencies for company ${integration.companyId}`
        );
        const { error: upsertError } = await serviceRole
          .from("currency")
          .upsert(updates);
        if (upsertError) {
          console.error(
            `Error updating currencies for company ${
              integration.companyId
            }: ${JSON.stringify(upsertError)}`
          );
        } else {
          console.log(
            `Successfully updated currencies for company ${integration.companyId}`
          );
        }
      } catch (err) {
        console.error(
          `Unexpected error processing company ${integration.companyId}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    console.log(
      `💵 Exchange Rates Task Completed: ${new Date().toISOString()}`
    );
  },
});
