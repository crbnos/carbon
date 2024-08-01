import { intervalTrigger } from "@trigger.dev/sdk";
import type { ExchangeRatesClient, Rates } from "~/lib/exchange-rates.server";
import { getExchangeRatesClient } from "~/lib/exchange-rates.server";
import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";
import type { CurrencyCode } from "~/modules/accounting";
import { exchangeRatesFormValidator } from "~/modules/settings";

const supabaseClient = getSupabaseServiceRole();

const job = triggerClient.defineJob({
  id: "update-exchange-rates",
  name: "Update Currency Exchange Rates",
  version: "0.0.1",
  trigger: intervalTrigger({
    seconds: 60 * 60 * 8, // thrice a day
  }),
  run: async (payload, io, ctx) => {
    let rates: Rates;
    let hasRates = false;
    let exchangeRatesClient: ExchangeRatesClient | undefined;

    const integrations = await supabaseClient
      .from("companyIntegration")
      .select("active, metadata, companyId")
      .eq("id", "exchange-rates-v1");

    if (integrations.error) {
      io.logger.error(JSON.stringify(integrations.error));
      return;
    }

    await io.logger.info(`💵 Exchange Rates Job: ${payload.lastTimestamp}`);
    for await (const integration of integrations.data) {
      const integrationMetadata = exchangeRatesFormValidator.safeParse(
        integration?.metadata
      );

      if (!integrationMetadata.success || integration?.active !== true) return;

      try {
        if (!hasRates) {
          exchangeRatesClient = getExchangeRatesClient(
            integrationMetadata.data.apiKey
          );

          if (!exchangeRatesClient) return;
          await io.logger.info(
            JSON.stringify(exchangeRatesClient.getMetaData())
          );
          rates = await exchangeRatesClient.getExchangeRates();
          await io.logger.info(JSON.stringify(rates));
          hasRates = true;
        }
        // @ts-expect-error
        if (!rates) throw new Error("No rates found");

        const updatedAt = new Date().toISOString();

        const { data } = await supabaseClient
          .from("currency")
          .select("*")
          .eq("companyId", integration.companyId);
        if (!data) return;

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

        if (updates?.length === 0) return;

        const { error } = await supabaseClient.from("currency").upsert(updates);
        if (error) {
          await io.logger.error(JSON.stringify(error));
          return;
        }
      } catch (err) {
        // TODO: notify someone
        await io.logger.error(JSON.stringify(err));
      }
    }
    io.logger.log("Success");
  },
});

export default job;
