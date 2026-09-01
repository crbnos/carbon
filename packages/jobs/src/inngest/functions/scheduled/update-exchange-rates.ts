import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Rates } from "@carbon/ee/exchange-rates.server";
import { getExchangeRatesClient } from "@carbon/ee/exchange-rates.server";
import { EXCHANGE_RATES_API_KEY } from "@carbon/env";
import { round } from "@carbon/utils";
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

      // `currency` rows are scoped to a company GROUP, but `companyIntegration`
      // is scoped to a COMPANY. Rebasing once per company therefore wrote every
      // company's own base-currency view into the same shared rows, so a group
      // whose companies use different base currencies had them overwrite each
      // other and the last one processed won for everybody.
      //
      // Resolve the group's base currency first, then rebase and write once.
      const companies = await serviceRole
        .from("company")
        .select("id, companyGroupId, baseCurrencyCode")
        .in(
          "id",
          integrations.data.map((i) => i.companyId)
        );

      if (companies.error) {
        logger.error("Error fetching companies", { error: companies.error });
        return;
      }

      const groups = new Map<string, { code: string; companyId: string }[]>();
      for (const company of companies.data ?? []) {
        if (!company.companyGroupId) {
          logger.warn("Company has no companyGroupId, skipping", {
            companyId: company.id
          });
          continue;
        }
        if (!company.baseCurrencyCode) {
          logger.warn("Company has no baseCurrencyCode, skipping", {
            companyId: company.id
          });
          continue;
        }
        const bucket = groups.get(company.companyGroupId) ?? [];
        bucket.push({ code: company.baseCurrencyCode, companyId: company.id });
        groups.set(company.companyGroupId, bucket);
      }

      // Collected so one misconfigured group cannot stop the others from being
      // updated, while the step still ends in a visible failure.
      const conflictingGroups: { companyGroupId: string; bases: string[] }[] =
        [];

      for (const [companyGroupId, members] of groups) {
        const bases = [...new Set(members.map((m) => m.code))];

        // One shared rate set cannot express two base currencies at once, and
        // nothing in the schema records a group-level base. Refuse rather than
        // let one member silently rebase the other's rates.
        if (bases.length > 1) {
          logger.error(
            "Company group has members with different base currencies; refusing to rebase shared rates",
            { companyGroupId, baseCurrencyCodes: bases }
          );
          conflictingGroups.push({ companyGroupId, bases });
          continue;
        }

        const baseCurrencyCode = bases[0] as CurrencyCode;
        let rates = cachedRates[baseCurrencyCode];
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
          const { data, error } = await serviceRole
            .from("currency")
            .select("*")
            .eq("companyGroupId", companyGroupId);

          if (error) {
            logger.error("Error fetching currencies for group", {
              companyGroupId,
              error
            });
            continue;
          }

          if (!data || data.length === 0) {
            logger.info("No currencies found for group", { companyGroupId });
            continue;
          }

          // A currency the feed omits keeps whatever rate it already had. That
          // is silent staleness, so name them rather than dropping them quietly.
          const missing = data
            .filter((currency) => !rates[currency.code as CurrencyCode])
            .map((currency) => currency.code);
          if (missing.length > 0) {
            logger.warn(
              "No rate returned for these currencies; leaving them stale",
              {
                companyGroupId,
                baseCurrencyCode,
                currencyCodes: missing
              }
            );
          }

          const updates = data
            .map((currency) => ({
              ...currency,
              // Rates carry internal scale — never the currency's DISPLAY
              // decimals, which zeroed every 0-decimal currency's fraction and
              // silently froze rates that rounded to 0
              exchangeRate: round(Number(rates[currency.code as CurrencyCode])),
              updatedBy: "system",
              updatedAt
            }))
            .filter((currency) => currency.exchangeRate);

          if (updates.length === 0) {
            logger.info("No currency updates needed for group", {
              companyGroupId
            });
            continue;
          }

          logger.info("Updating currencies for group", {
            count: updates.length,
            companyGroupId
          });
          const { error: upsertError } = await serviceRole
            .from("currency")
            .upsert(updates);
          if (upsertError) {
            logger.error("Error updating currencies for group", {
              companyGroupId,
              error: upsertError
            });
          } else {
            logger.info("Successfully updated currencies for group", {
              companyGroupId
            });
          }
        } catch (err) {
          logger.error("Unexpected error processing group", {
            companyGroupId,
            error: err
          });
        }
      }

      logger.info("Exchange rates task completed");

      // Throw AFTER every healthy group has been updated. Returning normally
      // would let Inngest record a success, so a group whose members disagree
      // on base currency would sit un-rebased indefinitely with nothing but a
      // log line to show for it.
      if (conflictingGroups.length > 0) {
        throw new Error(
          `Refused to rebase ${conflictingGroups.length} company group(s) whose members disagree on base currency: ` +
            conflictingGroups
              .map((g) => `${g.companyGroupId} (${g.bases.join(", ")})`)
              .join("; ")
        );
      }
    });
  }
);
