// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getStripeConnectAccountId } from "@carbon/stripe/send-sales-invoice.server";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import {
  getRentalAgreement,
  rentalAgreementInvoiceAutomationValidator,
  rentalAgreementValidator,
  updateRentalAgreement,
  updateRentalAgreementInvoiceAutomation
} from "~/modules/sales";

const logger = getLogger("erp", "rental-agreement-update");

/** The terms, as `rentalAgreementValidator` names them. */
const TERM_FIELDS = [
  "customerId",
  "customerLocationId",
  "customerContactId",
  "salesPersonId",
  "locationId",
  "startDate",
  "endDate",
  "billingCycle",
  "billingTiming",
  "paymentTermId",
  "currencyCode",
  "depositAmount",
  "taxPercent",
  "discountRate",
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain",
  "notes"
] as const;
type TermField = (typeof TERM_FIELDS)[number];

const BOOLEAN_FIELDS = new Set<TermField>([
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionReasonablyCertain"
]);

const isTermField = (field: string): field is TermField =>
  (TERM_FIELDS as readonly string[]).includes(field);

/**
 * One term of a Draft agreement, saved from its properties panel.
 *
 * The terms are validated as a whole (an end date after the start, a purchase
 * option that is reasonably certain needs an end date), so a single field is
 * never written on its own: the current terms are read, the one field is
 * swapped in, and the merged set runs through the same validator and service
 * the full terms form uses. A field that would leave the agreement in a state
 * the form refuses is refused here too.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const id = formData.get("id");
  const field = formData.get("field");
  const value = formData.get("value");

  // Invoicing is not a term: it stays editable while Active, so it skips the
  // Draft-only terms path below.
  if (formData.get("intent") === "invoiceAutomation") {
    if (
      typeof id !== "string" ||
      (typeof value !== "string" && value !== null)
    ) {
      return { error: { message: "Invalid form data" }, data: null };
    }
    const parsed = rentalAgreementInvoiceAutomationValidator.safeParse({
      invoiceAutomation: value === "" || value === null ? null : value
    });
    if (!parsed.success) {
      return { error: { message: "Invalid invoicing setting" }, data: null };
    }
    // As the company setting: with no Stripe account connected every invoice
    // would be held.
    if (
      parsed.data.invoiceAutomation === "Post and Send via Stripe" &&
      !(await getStripeConnectAccountId(getCarbonServiceRole(), companyId))
    ) {
      return {
        error: { message: "Connect Stripe in Integrations first" },
        data: null
      };
    }
    const update = await updateRentalAgreementInvoiceAutomation(client, {
      id,
      companyId,
      invoiceAutomation: parsed.data.invoiceAutomation,
      updatedBy: userId
    });
    if (update.error) {
      logger.error("rental agreement invoicing update failed", {
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

  if (
    typeof id !== "string" ||
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null) ||
    !isTermField(field)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  const current = await getRentalAgreement(client, id, companyId);
  if (current.error || current.data?.companyId !== companyId) {
    logger.error("rental agreement not found for update", {
      companyId,
      id,
      error: current.error
    });
    return { error: { message: "Rental agreement not found" }, data: null };
  }
  const agreement = current.data;
  if (agreement.status !== "Draft") {
    return {
      error: { message: "Only a Draft rental agreement's terms can be edited" },
      data: null
    };
  }

  const terms: Record<TermField, unknown> = {
    customerId: agreement.customerId,
    customerLocationId: agreement.customerLocationId,
    customerContactId: agreement.customerContactId,
    salesPersonId: agreement.salesPersonId,
    locationId: agreement.locationId,
    startDate: agreement.startDate,
    endDate: agreement.endDate,
    billingCycle: agreement.billingCycle,
    billingTiming: agreement.billingTiming,
    paymentTermId: agreement.paymentTermId,
    currencyCode: agreement.currencyCode,
    depositAmount: agreement.depositAmount,
    taxPercent: agreement.taxPercent,
    discountRate: agreement.discountRate,
    ownershipTransfers: agreement.ownershipTransfers,
    specializedAsset: agreement.specializedAsset,
    purchaseOptionAmount: agreement.purchaseOptionAmount,
    purchaseOptionReasonablyCertain: agreement.purchaseOptionReasonablyCertain,
    notes: agreement.notes
  };

  terms[field] = BOOLEAN_FIELDS.has(field)
    ? value === "on" || value === "true"
    : value || null;
  // A site and contact belong to one customer.
  if (field === "customerId" && value !== agreement.customerId) {
    terms.customerLocationId = null;
    terms.customerContactId = null;
  }

  // The same FormData the terms form posts, so the same zfd coercion applies.
  const merged = new FormData();
  for (const key of TERM_FIELDS) {
    const term = terms[key];
    if (BOOLEAN_FIELDS.has(key)) {
      if (term) merged.append(key, "on");
    } else if (term !== null && term !== undefined && term !== "") {
      merged.append(key, String(term));
    }
  }

  if (field === "currencyCode" && value && value !== agreement.currencyCode) {
    const exchangeRate = await getExchangeRate(client, companyId, value);
    if (exchangeRate.error) {
      // A missing rate is an error, never 1.
      return { error: exchangeRate.error, data: null };
    }
    merged.append("exchangeRate", String(exchangeRate.data));
  }

  const validation = await validator(rentalAgreementValidator).validate(merged);
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ??
      "These terms are not valid";
    return { error: { message }, data: null };
  }

  const {
    id: _id,
    rentalAgreementId: _rentalAgreementId,
    ...data
  } = validation.data;

  const update = await updateRentalAgreement(client, {
    ...data,
    id,
    companyId,
    updatedBy: userId,
    // Not a term: carried through so saving one term keeps them.
    customFields: agreement.customFields ?? undefined
  });
  if (update.error) {
    logger.error("rental agreement term update failed", {
      companyId,
      id,
      field,
      error: update.error
    });
    return {
      error: {
        message: update.error.message || "Failed to update rental agreement"
      },
      data: null
    };
  }

  return { error: null, data: update.data };
}
