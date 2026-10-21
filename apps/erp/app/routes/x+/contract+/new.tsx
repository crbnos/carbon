// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ContractBillingBasis } from "@carbon/utils";
import { redirect, suggestContractType } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SetupFrame } from "~/components/Setup";
import { useCompanyToday, useUser } from "~/hooks";
import { getExchangeRate } from "~/modules/accounting";
import {
  customerContractValidator,
  getCustomerContractStatuses,
  insertContract,
  projectContractTermDefaults
} from "~/modules/sales";
import { contractInvoicingDefaults } from "~/modules/sales/sales.server";
import {
  ContractDetailsForm,
  ContractSetupSteps,
  ProjectContractDetailsForm
} from "~/modules/sales/ui/Contracts";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: (_params: unknown, data: unknown) => [
    (data as { billingBasis?: ContractBillingBasis } | undefined)
      ?.billingBasis === "Project"
      ? { breadcrumb: msg`Project Contracts`, to: path.to.projectContracts }
      : { breadcrumb: msg`Service Contracts`, to: path.to.contracts }
  ],
  to: path.to.contracts
};

/** `?basis=Project` starts a project contract, `?projectId=` with its
 *  project picked. A contract started from a customer (`?customerId=`) opens
 *  with that customer's currency and suggested type already filled in. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "sales"
  });

  const searchParams = new URL(request.url).searchParams;
  const billingBasis: ContractBillingBasis =
    searchParams.get("basis") === "Project" ? "Project" : "Schedule";
  const requestedProjectId = searchParams.get("projectId");
  const project =
    billingBasis === "Project" && requestedProjectId
      ? await client
          .from("project")
          .select("id")
          .eq("id", requestedProjectId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null;
  const projectId = project?.data?.id ?? null;

  const customerId = searchParams.get("customerId");
  if (!customerId) {
    return {
      billingBasis,
      projectId,
      customerId: null,
      currencyCode: null,
      type: null
    };
  }

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
    return {
      billingBasis,
      projectId,
      customerId: null,
      currencyCode: null,
      type: null
    };
  }

  return {
    billingBasis,
    projectId,
    customerId,
    currencyCode: customer.data.currencyCode,
    type: previous.data ? suggestContractType(previous.data) : null
  };
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
    ...posted
  } = validation.data;

  // A project contract runs over its period of performance: no duration (so
  // no term months), and the billing terms its basis fixes. Only the billing
  // frequency is the user's.
  const isProject = posted.billingBasis === "Project";
  const data = isProject
    ? {
        ...posted,
        ...projectContractTermDefaults,
        billingFrequency:
          posted.billingFrequency ??
          projectContractTermDefaults.billingFrequency,
        duration: undefined,
        renewalUplift: 0
      }
    : posted;
  const listPath = isProject ? path.to.projectContracts : path.to.contracts;

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
        listPath,
        await flash(
          request,
          error(previous.error, "Failed to read the customer's contracts")
        )
      );
    }
    contractType = suggestContractType(previous.data ?? []);
  }

  // Who the invoices go to, where and on what terms: the customer's own
  // invoicing and shipping defaults, for whatever the form left empty.
  const defaults = await contractInvoicingDefaults(
    client,
    companyId,
    data.customerId
  );

  const sequence = await getNextSequence(client, "customerContract", companyId);
  if (sequence.error || !sequence.data) {
    throw redirect(
      listPath,
      await flash(
        request,
        error(sequence.error, "Failed to get the next contract number")
      )
    );
  }

  // The rate is looked up, never assumed 1 — the properties panel does the
  // same when the currency changes (`update.tsx`).
  const exchangeRate = await getExchangeRate(
    client,
    companyId,
    data.currencyCode
  );
  if (exchangeRate.error || !exchangeRate.data) {
    throw redirect(
      listPath,
      await flash(
        request,
        error(exchangeRate.error, "Failed to get the exchange rate")
      )
    );
  }

  const contract = await insertContract(client, {
    ...data,
    invoiceCustomerId: data.invoiceCustomerId ?? defaults.invoiceCustomerId,
    invoiceCustomerContactId:
      data.invoiceCustomerContactId ?? defaults.invoiceCustomerContactId,
    invoiceCustomerLocationId:
      data.invoiceCustomerLocationId ?? defaults.invoiceCustomerLocationId,
    shipToCustomerLocationId:
      data.shipToCustomerLocationId ?? defaults.shipToCustomerLocationId,
    paymentTermId: data.paymentTermId ?? defaults.paymentTermId,
    exchangeRate: Number(exchangeRate.data),
    contractType,
    customerContractId: sequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (contract.error || !contract.data) {
    throw redirect(
      listPath,
      await flash(request, error(contract.error, "Failed to create contract"))
    );
  }

  throw redirect(path.to.contractSetup(contract.data.id, "products"));
}

/** Step 1 of the contract setup: creating the Draft, a service contract or
 *  (`?basis=Project`) a project contract. Every later step edits the Draft
 *  this saves (`$id.setup.*`). */
export default function NewContractRoute() {
  const prefill = useLoaderData<typeof loader>();
  const { company, id: userId } = useUser();
  const companyToday = useCompanyToday();
  const currencyCode =
    prefill.currencyCode ?? company?.baseCurrencyCode ?? "USD";

  if (prefill.billingBasis === "Project") {
    return (
      <SetupFrame
        title={<Trans>New Project Contract</Trans>}
        step="details"
        steps={<ContractSetupSteps current="details" billingBasis="Project" />}
      >
        <ProjectContractDetailsForm
          initialValues={{
            id: undefined,
            customerContractId: undefined,
            name: "",
            customerId: prefill.customerId ?? "",
            projectId: prefill.projectId ?? undefined,
            // The person setting the contract up is usually the one who sold it.
            salesPersonId: userId,
            closeDate: companyToday,
            billingBasis: "Project",
            startDate: companyToday,
            endDate: undefined,
            renewalUplift: 0,
            billingFrequency: projectContractTermDefaults.billingFrequency,
            currencyCode
          }}
          action={path.to.newContract}
        />
      </SetupFrame>
    );
  }

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
    currencyCode
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
