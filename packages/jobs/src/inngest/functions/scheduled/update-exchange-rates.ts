import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Rates } from "@carbon/ee/exchange-rates.server";
import { getExchangeRatesClient } from "@carbon/ee/exchange-rates.server";
import { EXCHANGE_RATES_API_KEY } from "@carbon/env";
import { inngest } from "../../client";

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

export const updateExchangeRatesFunction = inngest.createFunction(
  { id: "update-exchange-rates", retries: 2 },
  { cron: "0 0 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    await step.run("fetch-and-update-exchange-rates", async () => {
      logger.info("Exchange rates task started");
      const integrations = await serviceRole
        .from("companyIntegration")
        .select("active, companyId")
        .eq("id", "exchange-rates-v1")
        .eq("active", true);

      if (integrations.error) {
        logger.error("Error fetching integrations", {
          error: integrations.error
        });
        return;
      }

      if (integrations.data?.length === 0) {
        logger.info("No active exchange rate integrations found, exiting task");
        return;
      }

      logger.info("Found active integrations", {
        count: integrations.data.length
      });

      // Fetch the exchange rates for the base currency of EUR
      const exchangeRatesClient = getExchangeRatesClient(
        EXCHANGE_RATES_API_KEY
      );

      if (!exchangeRatesClient) {
        logger.error(
          "Exchange rates client is undefined, check API key configuration"
        );
        return;
      }

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

      // Cache the rates for each currency to avoid unnecessary computations
      let cachedRates: { [key in CurrencyCode]?: Rates } = {
        EUR: ratesEUR
      };

      for (const integration of integrations.data) {
        logger.info("Processing integration for company", {
          companyId: integration.companyId
        });

        const company = await serviceRole
          .from("company")
          .select("*")
          .eq("id", integration.companyId)
          .single();

        if (company.error) {
          logger.error("Error fetching company", {
            companyId: integration.companyId,
            error: company.error
          });
          continue;
        }

        const baseCurrencyCode = company.data.baseCurrencyCode as CurrencyCode;
        let rates: Rates | undefined;
        rates = cachedRates[baseCurrencyCode];
        // Check if the rates for this base currency are cached, and if not compute them
        if (rates) {
          logger.info("Using cached rates", { baseCurrencyCode });
        } else {
          logger.info("Computing rates", { baseCurrencyCode });
          rates = await exchangeRatesClient.convertExchangeRates(
            baseCurrencyCode,
            ratesEUR
          );
          cachedRates[baseCurrencyCode] = rates;
        }

        const updatedAt = new Date().toISOString();

        try {
          if (!company.data.companyGroupId) {
            logger.warn("Company has no companyGroupId, skipping", {
              companyId: integration.companyId
            });
            continue;
          }
          const { data, error } = await serviceRole
            .from("currency")
            .select("*")
            .eq("companyGroupId", company.data.companyGroupId);

          if (error) {
            logger.error("Error fetching currencies for company", {
              companyId: integration.companyId,
              error
            });
            continue;
          }

          if (!data || data.length === 0) {
            logger.info("No currencies found for company", {
              companyId: integration.companyId
            });
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
              updatedAt
            }))
            .filter((currency) => currency.exchangeRate);

          if (updates.length === 0) {
            logger.info("No currency updates needed for company", {
              companyId: integration.companyId
            });
            continue;
          }

          logger.info("Updating currencies for company", {
            count: updates.length,
            companyId: integration.companyId
          });
          const { error: upsertError } = await serviceRole
            .from("currency")
            .upsert(updates);
          if (upsertError) {
            logger.error("Error updating currencies for company", {
              companyId: integration.companyId,
              error: upsertError
            });
          } else {
            logger.info("Successfully updated currencies for company", {
              companyId: integration.companyId
            });
          }
        } catch (err) {
          logger.error("Unexpected error processing company", {
            companyId: integration.companyId,
            error: err
          });
        }
      }

      logger.info("Exchange rates task completed");
    });
  }
);
