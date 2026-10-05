// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getStripeConnectAccountId } from "@carbon/stripe/send-sales-invoice.server";
import { round, textToTiptap } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getExchangeRate } from "~/modules/accounting";
import {
  customerContractInvoiceAutomationValidator,
  customerContractTypes,
  customerContractValidator,
  getContract,
  updateContract,
  updateContractInvoiceAutomation,
  updateContractNotes,
  updateContractType
} from "~/modules/sales";
import { contractCustomerChange } from "~/modules/sales/sales.server";
import { contractDurationOf } from "~/modules/sales/ui/Contracts";
import { getCompanySettings } from "~/modules/settings";

const logger = getLogger("erp", "contract-update");

/** The terms, as `customerContractValidator` names them. `contractType` and
 *  `invoiceAutomation` are not here: they stay editable while Active, so
 *  each has its own intent. */
const TERM_FIELDS = [
  "name",
  "customerId",
  "invoiceCustomerId",
  "invoiceCustomerContactId",
  "invoiceCustomerLocationId",
  "shipToCustomerLocationId",
  "salesPersonId",
  "projectId",
  "customerReference",
  "closeDate",
  "startDate",
  "duration",
  "endDate",
  "renewal",
  "renewalUplift",
  "billingFrequency",
  "billingAlignment",
  "billingTiming",
  "firstInvoiceDate",
  "billedThrough",
  "recognizeRevenueFrom",
  "paymentTermId",
  "currencyCode",
  "notes"
] as const;
type TermField = (typeof TERM_FIELDS)[number];

const isTermField = (field: string): field is TermField =>
  (TERM_FIELDS as readonly string[]).includes(field);

const contractTypeValidator = z.object({
  contractType: z.enum(customerContractTypes)
});

/** Plain text from the properties panel as the rich-text document the
 *  column holds; empty clears it. */
const notesDoc = (value: string | null) => (value ? textToTiptap(value) : null);

/**
 * One property of a contract, saved from its properties panel.
 *
 * A Draft's terms are validated as a whole (an end date after the start, a
 * custom duration needs an end date), so a single field is never written on
 * its own: the current terms are read, the one field is swapped in, and the
 * merged set runs through the same validator and service the new contract
 * form uses. An Active contract's terms change with Amend; only its type,
 * invoicing and notes stay editable here.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const id = formData.get("id");
  const intent = formData.get("intent");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof id !== "string" || (typeof value !== "string" && value !== null)) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  if (intent === "invoiceAutomation") {
    const parsed = customerContractInvoiceAutomationValidator.safeParse({
      invoiceAutomation: value === "" || value === null ? null : value
    });
    if (!parsed.success) {
      return { error: { message: "Invalid invoicing setting" }, data: null };
    }
    const { invoiceAutomation } = parsed.data;

    // As the company setting: with no Stripe account connected every invoice
    // would be held.
    if (
      invoiceAutomation === "Post and Send via Stripe" &&
      !(await getStripeConnectAccountId(getCarbonServiceRole(), companyId))
    ) {
      return {
        error: { message: "Connect Stripe in Integrations first" },
        data: null
      };
    }

    // A confirmed contract's invoices post on their own in any mode but
    // Draft Only, so choosing one needs the invoicing permission, as
    // confirming does. A Draft is checked when it is confirmed.
    if (invoiceAutomation !== "Draft Only") {
      const current = await getContract(client, id);
      if (current.error || current.data?.companyId !== companyId) {
        return { error: { message: "Contract not found" }, data: null };
      }
      if (current.data.status !== "Draft") {
        // Null is the company's setting; an unreadable one is treated as
        // posting.
        const effective =
          invoiceAutomation ??
          (await getCompanySettings(client, companyId)).data?.invoiceAutomation;
        if (effective !== "Draft Only") {
          await requirePermissions(request, {
            update: "sales",
            create: "invoicing"
          });
        }
      }
    }

    const update = await updateContractInvoiceAutomation(client, {
      id,
      companyId,
      invoiceAutomation,
      updatedBy: userId
    });
    if (update.error) {
      logger.error("contract invoicing update failed", {
        companyId,
        id,
        error: update.error
      });
      return {
        error: {
          message: update.error.message || "Failed to update invoicing"
        },
        data: null
      };
    }
    return { error: null, data: update.data };
  }

  if (intent === "contractType") {
    const parsed = contractTypeValidator.safeParse({ contractType: value });
    if (!parsed.success) {
      return { error: { message: "Invalid contract type" }, data: null };
    }
    const update = await updateContractType(client, {
      id,
      companyId,
      contractType: parsed.data.contractType,
      updatedBy: userId
    });
    if (update.error) {
      logger.error("contract type update failed", {
        companyId,
        id,
        error: update.error
      });
      return {
        error: {
          message: update.error.message || "Failed to update contract type"
        },
        data: null
      };
    }
    return { error: null, data: update.data };
  }

  if (typeof field !== "string" || !isTermField(field)) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  const current = await getContract(client, id);
  if (current.error || current.data?.companyId !== companyId) {
    logger.error("contract not found for update", {
      companyId,
      id,
      error: current.error
    });
    return { error: { message: "Contract not found" }, data: null };
  }
  const contract = current.data;

  if (contract.status !== "Draft") {
    if (field !== "notes") {
      return {
        error: {
          message: "Only a Draft contract's terms can be edited — use Amend"
        },
        data: null
      };
    }
    // Notes are not a term: they stay editable after Confirm.
    const update = await updateContractNotes(client, {
      id,
      companyId,
      notes: notesDoc(value),
      updatedBy: userId
    });
    if (update.error) {
      logger.error("contract notes update failed", {
        companyId,
        id,
        error: update.error
      });
      return {
        error: { message: update.error.message || "Failed to update notes" },
        data: null
      };
    }
    return { error: null, data: update.data };
  }

  const terms: Record<TermField, unknown> = {
    name: contract.name,
    customerId: contract.customerId,
    invoiceCustomerId: contract.invoiceCustomerId,
    invoiceCustomerContactId: contract.invoiceCustomerContactId,
    invoiceCustomerLocationId: contract.invoiceCustomerLocationId,
    shipToCustomerLocationId: contract.shipToCustomerLocationId,
    salesPersonId: contract.salesPersonId,
    projectId: contract.projectId,
    customerReference: contract.customerReference,
    closeDate: contract.closeDate,
    startDate: contract.startDate,
    duration: contractDurationOf({
      endDate: contract.endDate,
      termMonths: contract.termMonths
    }),
    endDate: contract.endDate,
    renewal: contract.renewal,
    // Stored as a fraction; the form speaks percent points.
    renewalUplift: round(Number(contract.renewalUplift ?? 0) * 100),
    billingFrequency: contract.billingFrequency,
    billingAlignment: contract.billingAlignment,
    billingTiming: contract.billingTiming,
    firstInvoiceDate: contract.firstInvoiceDate,
    billedThrough: contract.billedThrough,
    recognizeRevenueFrom: contract.recognizeRevenueFrom,
    paymentTermId: contract.paymentTermId,
    currencyCode: contract.currencyCode,
    // The stored document, re-encoded so the validator keeps it as is.
    notes: contract.notes ? JSON.stringify(contract.notes) : null
  };

  terms[field] =
    field === "notes"
      ? value
        ? JSON.stringify(textToTiptap(value))
        : null
      : value || null;
  // Picking an end date is choosing a custom term.
  if (field === "endDate") terms.duration = "custom";
  // A different customer brings its own bill-to, contact, addresses and
  // payment terms, as in setup step 1.
  if (field === "customerId") {
    const invoicing = await contractCustomerChange(client, companyId, {
      from: contract.customerId,
      to: value
    });
    if (invoicing) Object.assign(terms, invoicing);
  }
  // A contact and address belong to the bill-to customer.
  if (field === "invoiceCustomerId" && value !== contract.invoiceCustomerId) {
    terms.invoiceCustomerContactId = null;
    terms.invoiceCustomerLocationId = null;
  }

  // The same FormData the new contract form posts, so the same zfd coercion
  // applies.
  const merged = new FormData();
  for (const key of TERM_FIELDS) {
    const term = terms[key];
    if (term !== null && term !== undefined && term !== "") {
      merged.append(key, String(term));
    }
  }
  // Not a term, but the terms service writes it: carried so saving a term
  // never resets the contract to the company's invoicing setting.
  if (contract.invoiceAutomation) {
    merged.append("invoiceAutomation", contract.invoiceAutomation);
  }

  if (field === "currencyCode" && value && value !== contract.currencyCode) {
    const exchangeRate = await getExchangeRate(client, companyId, value);
    if (exchangeRate.error) {
      // A missing rate is an error, never 1.
      return { error: exchangeRate.error, data: null };
    }
    merged.append("exchangeRate", String(exchangeRate.data));
  }

  const validation = await validator(customerContractValidator).validate(
    merged
  );
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ??
      "These terms are not valid";
    return { error: { message }, data: null };
  }

  const {
    id: _id,
    customerContractId: _customerContractId,
    ...data
  } = validation.data;

  const update = await updateContract(client, {
    ...data,
    // Not a term: `contractType` is left alone (an omitted type is kept).
    contractType: undefined,
    id,
    updatedBy: userId,
    // Not a term: carried through so saving one term keeps them.
    customFields: contract.customFields ?? undefined
  });
  if (update.error) {
    logger.error("contract term update failed", {
      companyId,
      id,
      field,
      error: update.error
    });
    return {
      error: { message: update.error.message || "Failed to update contract" },
      data: null
    };
  }

  return { error: null, data: update.data };
}
