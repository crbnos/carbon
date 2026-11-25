// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { rentalEarlyInvoiceValidator } from "~/modules/sales/sales.models";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(rentalEarlyInvoiceValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.sales.invoiceRentalAgreementPeriods({
    rentalAgreementId: input.params.id,
    periods: input.data.periods,
    fromPeriodStart: input.data.fromPeriodStart
  });
  const drafted = result.data;
  return respond(args.request, result).redirect(
    drafted?.invoiceId
      ? path.to.salesInvoiceDetails(drafted.invoiceId)
      : drafted?.creditMemoId
        ? path.to.memo(drafted.creditMemoId)
        : path.to.rentalAgreementDetails(input.params.id),
    {
      message: drafted?.creditMemoId
        ? drafted.invoiceId
          ? "Drafted the invoice and a credit memo for the early return"
          : "Drafted a credit memo for the early return"
        : "Drafted the invoice",
      onError: path.to.rentalAgreementDetails(input.params.id)
    }
  );
}
