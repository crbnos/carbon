// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { redirect, suggestContractType } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SetupFrame } from "~/components/Setup";
import { useCompanyToday, useUser } from "~/hooks";
import { customerContractValidator } from "~/modules/sales/sales.models";
import { getCustomerContractStatuses } from "~/modules/sales/sales.service";
import {
  ContractDetailsForm,
  ContractSetupSteps
} from "~/modules/sales/ui/Contracts";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Service Contracts`,
  to: path.to.contracts
};

/** A contract started from a customer (`?customerId=`) opens with that
 *  customer's currency and suggested type already filled in. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "sales"
  });

  const customerId = new URL(request.url).searchParams.get("customerId");
  if (!customerId) return { customerId: null, currencyCode: null, type: null };

  const [customer, previous] = await Promise.all([
    client
      .from("customer")
      .select("currencyCode")
      .eq("id", customerId)
      .eq("companyId", companyId)
      .maybeSingle(),
    getCustomerContractStatuses(client, companyId, customerId)
  ]);
  if (!customer.data) {
    return { customerId: null, currencyCode: null, type: null };
  }

  return {
    customerId,
    currencyCode: customer.data.currencyCode,
    type: previous.data ? suggestContractType(previous.data) : null
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customerContractValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.createContract({
    ...input.data,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  if (!result.data) {
    return respond(args.request, result).redirect(path.to.contracts, {
      message: ""
    });
  }
  throw redirect(path.to.contractSetup(result.data.id, "products"));
}

export default function NewContractRoute() {
  const prefill = useLoaderData<typeof loader>();
  const { company, id: userId } = useUser();
  const companyToday = useCompanyToday();

  const initialValues = {
    id: undefined,
    customerContractId: undefined,
    name: "",
    contractType: prefill.type ?? undefined,
    customerId: prefill.customerId ?? "",
    // The person setting the contract up is usually the one who sold it.
    salesPersonId: userId,
    closeDate: companyToday,
    startDate: companyToday,
    duration: "12" as const,
    renewal: "End" as const,
    renewalUplift: 0,
    // What a new contract bills on until the Invoicing step says otherwise.
    billingFrequency: "Month" as const,
    billingAlignment: "Anniversary" as const,
    billingTiming: "Advance" as const,
    currencyCode: prefill.currencyCode ?? company?.baseCurrencyCode ?? "USD"
  };

  return (
    <SetupFrame
      title={<Trans>New Contract</Trans>}
      step="details"
      steps={<ContractSetupSteps current="details" />}
    >
      <ContractDetailsForm
        initialValues={initialValues}
        action={path.to.newContract}
      />
    </SetupFrame>
  );
}
