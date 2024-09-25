import { getCarbonServiceRole } from "@carbon/auth";
import { task, wait } from "@trigger.dev/sdk/v3";
import type { ExchangeRatesClient, Rates } from "~/lib/exchange-rates.server";
import { getExchangeRatesClient } from "~/lib/exchange-rates.server";
import type { CurrencyCode } from "~/modules/accounting";
import { exchangeRatesFormValidator } from "~/modules/settings";

const serviceRole = getCarbonServiceRole();

export const updateExchangeRates = task({
  id: "update-exchange-rates",
  run: async () => {
    let rates: Rates;
    let hasRates = false;
    let exchangeRatesClient: ExchangeRatesClient | undefined;

    const integrations = await serviceRole
      .from("companyIntegration")
      .select("active, metadata, companyId")
      .eq("id", "exchange-rates-v1");

    if (integrations.error) {
      console.error(JSON.stringify(integrations.error));
      return;
    }

    console.log(`💵 Exchange Rates Task: ${new Date().toISOString()}`);
    for (const integration of integrations.data) {
      const integrationMetadata = exchangeRatesFormValidator.safeParse(
        integration?.metadata
      );

      if (!integrationMetadata.success || integration?.active !== true)
        continue;

      try {
        if (!hasRates) {
          exchangeRatesClient = getExchangeRatesClient(
            integrationMetadata.data.apiKey
          );

          if (!exchangeRatesClient) continue;
          console.log(JSON.stringify(exchangeRatesClient.getMetaData()));
          rates = await exchangeRatesClient.getExchangeRates();
          console.log(JSON.stringify(rates));
          hasRates = true;
        }
        // @ts-expect-error
        if (!rates) throw new Error("No rates found");

        const updatedAt = new Date().toISOString();

        const { data } = await serviceRole
          .from("currency")
          .select("*")
          .eq("companyId", integration.companyId);
        if (!data) continue;

        const updates = data
          // eslint-disable-next-line no-loop-func
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

        if (updates?.length === 0) continue;

        const { error } = await serviceRole.from("currency").upsert(updates);
        if (error) {
          console.error(JSON.stringify(error));
          continue;
        }
      } catch (err) {
        // TODO: notify someone
        console.error(JSON.stringify(err));
      }
    }
    console.log("Success");

    // Wait for 8 hours before the next run
    await wait.for({ hours: 8 });
  },
});
