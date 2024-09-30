import { EXCHANGE_RATES_API_KEY, getCarbonServiceRole } from "@carbon/auth";
import { schedules } from "@trigger.dev/sdk/v3";
import type { Rates } from "~/lib/exchange-rates.server";
import { getExchangeRatesClient } from "~/lib/exchange-rates.server";
import type { CurrencyCode } from "~/modules/accounting";

const serviceRole = getCarbonServiceRole();

export const updateExchangeRates = schedules.task({
  id: "update-exchange-rates",
  cron: "0 0 * * *",
  run: async () => {
    let rates: Rates;

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

    const exchangeRatesClient = getExchangeRatesClient(EXCHANGE_RATES_API_KEY);
    if (!exchangeRatesClient) {
      console.error(
        "Exchange rates client is undefined. Check API key configuration."
      );
      return;
    }

    try {
      rates = await exchangeRatesClient.getExchangeRates();
      if (!rates) throw new Error("No rates returned from exchange rates API");
      console.log(
        `Successfully fetched exchange rates for ${
          Object.keys(rates).length
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

    const updatedAt = new Date().toISOString();

    for (const integration of integrations.data) {
      console.log(
        `Processing integration for company ID: ${integration.companyId}`
      );
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
