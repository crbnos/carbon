// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect, suggestContractType } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import {
  customerContractValidator,
  getCustomerContractStatuses,
  insertContract
} from "~/modules/sales";
import { ContractForm } from "~/modules/sales/ui/Contracts";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Contracts`,
  to: path.to.contracts
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "sales"
  });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(customerContractValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id: _id,
    customerContractId: _customerContractId,
    ...data
  } = validation.data;

  // Spec decision 17: suggested from the customer's previous contracts, and
  // editable afterwards. A type the form set is kept.
  let contractType = data.contractType;
  if (!contractType) {
    const previous = await getCustomerContractStatuses(
      client,
      companyId,
      data.customerId
    );
    if (previous.error) {
      throw redirect(
        path.to.contracts,
        await flash(
          request,
          error(previous.error, "Failed to read the customer's contracts")
        )
      );
    }
    contractType = suggestContractType(previous.data ?? []);
  }

  const sequence = await getNextSequence(client, "customerContract", companyId);
  if (sequence.error || !sequence.data) {
    throw redirect(
      path.to.contracts,
      await flash(
        request,
        error(sequence.error, "Failed to get the next contract number")
      )
    );
  }

  const contract = await insertContract(client, {
    ...data,
    contractType,
    customerContractId: sequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (contract.error || !contract.data) {
    throw redirect(
      path.to.contracts,
      await flash(request, error(contract.error, "Failed to create contract"))
    );
  }

  throw redirect(path.to.contractDetails(contract.data.id));
}

export default function NewContractRoute() {
  const [params] = useUrlParams();
  const { company } = useUser();
  const companyToday = useCompanyToday();

  const initialValues = {
    id: undefined,
    customerContractId: undefined,
    name: "",
    customerId: params.get("customerId") ?? "",
    closeDate: companyToday,
    startDate: companyToday,
    duration: "12" as const,
    renewal: "Renew" as const,
    renewalUplift: 0,
    billingFrequency: "Month" as const,
    billingAlignment: "Anniversary" as const,
    billingTiming: "Advance" as const,
    currencyCode: company?.baseCurrencyCode ?? "USD"
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <ContractForm initialValues={initialValues} />
    </div>
  );
}
