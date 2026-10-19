// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
  currencyFormValidator,
  exchangeRateOverrideValidator
} from "~/modules/accounting/accounting.models";
import {
  getCurrency,
  getExchangeRateHistory,
  getExchangeRates
} from "~/modules/accounting/accounting.service";
import { ExchangeRateForm } from "~/modules/accounting/ui/ExchangeRates";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

const resetForm = z.object({
  currencyCode: z.string().min(1, { message: "Currency code is required" })
});

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { currencyId } = params;
  if (!currencyId) throw notFound("currencyId not found");

  const currency = await getCurrency(client, currencyId);
  const code = currency.data?.code;

  const [exchangeRates, exchangeRateHistory] = code
    ? await Promise.all([
        getExchangeRates(client, companyId),
        getExchangeRateHistory(client, code)
      ])
    : [{ data: null }, { data: [] }];

  const resolved =
    exchangeRates.data?.find((rate) => rate.currencyCode === code) ?? null;

  return {
    currency: currency?.data ?? null,
    rate: resolved?.rate ?? null,
    rateSource: resolved?.source ?? null,
    exchangeRateHistory: exchangeRateHistory?.data ?? []
  };
}

export async function action(args: ActionFunctionArgs) {
  const { currencyId } = args.params;
  if (!currencyId) throw notFound("currencyId not found");
  // Saved: back to the list. Refused: back to the drawer, with the reason.
  const params = getParams(args.request);
  const answer = (
    result: { error: { message: string } | null },
    message: string
  ) =>
    respond(args.request, result).redirect(
      `${path.to.exchangeRates}?${params}`,
      {
        message: message,
        onError: `${path.to.exchangeRate(currencyId)}?${params}`
      }
    );

  const intent = (await args.request.clone().formData()).get("intent");

  if (intent === "override") {
    const input = await validator(exchangeRateOverrideValidator).request(args);
    if ("invalid" in input) return input.invalid;
    const api = await carbon(args.request);
    return answer(
      await api.accounting.overrideExchangeRate(input.data),
      "Updated exchange rate"
    );
  }

  if (intent === "reset") {
    const input = await validator(resetForm).request(args);
    if ("invalid" in input) return input.invalid;
    const api = await carbon(args.request);
    return answer(
      await api.accounting.resetExchangeRate(input.data),
      "Reset to market rate"
    );
  }

  const input = await validator(currencyFormValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...currency } = input.data;
  const api = await carbon(args.request);
  return answer(
    await api.accounting.updateCurrency({
      ...currency,
      currencyId,
      customFields: setCustomFields(input.formData ?? new FormData())
    }),
    "Updated currency"
  );
}

export default function EditExchangeRateRoute() {
  const { currency, rate, rateSource, exchangeRateHistory } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: currency?.id ?? undefined,
    name: currency?.currencyCode?.name ?? "",
    code: currency?.code ?? "",
    historicalExchangeRate: currency?.historicalExchangeRate ?? undefined,
    decimalPlaces: currency?.decimalPlaces ?? 2,
    ...getCustomFields(currency?.customFields)
  };

  return (
    <ExchangeRateForm
      key={initialValues.id}
      initialValues={initialValues}
      rate={rate}
      rateSource={rateSource}
      exchangeRateHistory={exchangeRateHistory}
    />
  );
}
