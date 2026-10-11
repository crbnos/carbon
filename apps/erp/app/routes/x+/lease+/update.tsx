// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getLease, leaseValidator, updateLease } from "~/modules/purchasing";
import { regenerateLeasePayments } from "~/modules/purchasing/purchasing.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "lease-update");

/** The terms, as `leaseValidator` names them. */
const TERM_FIELDS = [
  "name",
  "description",
  "supplierId",
  "supplierLocationId",
  "supplierContactId",
  "locationId",
  "assignee",
  "commencementDate",
  "endDate",
  "noticeDate",
  "invoiceFromDate",
  "paymentAmount",
  "paymentFrequency",
  "paymentTiming",
  "annualEscalationPercent",
  "discountRate",
  "currencyCode",
  "fairValue",
  "economicLifeMonths",
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain"
] as const;
type TermField = (typeof TERM_FIELDS)[number];

const BOOLEAN_FIELDS = new Set<TermField>([
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionReasonablyCertain"
]);

/** The terms the payment rows are cut from: a change cuts them again. */
const PAYMENT_TERM_FIELDS = new Set<TermField>([
  "commencementDate",
  "endDate",
  "invoiceFromDate",
  "paymentAmount",
  "paymentFrequency",
  "paymentTiming",
  "annualEscalationPercent",
  "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain"
]);

const isTermField = (field: string): field is TermField =>
  (TERM_FIELDS as readonly string[]).includes(field);

/**
 * One term of a Draft lease, saved from its properties panel.
 *
 * The terms are validated as a whole (an end date on or after the
 * commencement, a reasonably certain purchase option needs an amount), so a
 * single field is never written on its own: the current terms are read, the
 * one field is swapped in, and the merged set runs through the same
 * validator and service the new lease form uses. When a payment term
 * changes, the payment rows are cut again from the new terms.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const id = formData.get("id");
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof id !== "string" ||
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null) ||
    !isTermField(field)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  const current = await getLease(client, id, companyId);
  if (current.error || current.data?.companyId !== companyId) {
    logger.error("lease not found for update", {
      companyId,
      id,
      error: current.error
    });
    return { error: { message: "Lease not found" }, data: null };
  }
  const lease = current.data;
  if (lease.status !== "Draft") {
    return {
      error: { message: "Only a Draft lease's terms can be edited" },
      data: null
    };
  }

  const terms: Record<TermField, unknown> = {
    name: lease.name,
    description: lease.description,
    supplierId: lease.supplierId,
    supplierLocationId: lease.supplierLocationId,
    supplierContactId: lease.supplierContactId,
    locationId: lease.locationId,
    assignee: lease.assignee,
    commencementDate: lease.commencementDate,
    endDate: lease.endDate,
    noticeDate: lease.noticeDate,
    invoiceFromDate: lease.invoiceFromDate,
    paymentAmount: lease.paymentAmount,
    paymentFrequency: lease.paymentFrequency,
    paymentTiming: lease.paymentTiming,
    annualEscalationPercent: lease.annualEscalationPercent,
    discountRate: lease.discountRate,
    currencyCode: lease.currencyCode,
    fairValue: lease.fairValue,
    economicLifeMonths: lease.economicLifeMonths,
    ownershipTransfers: lease.ownershipTransfers,
    specializedAsset: lease.specializedAsset,
    purchaseOptionAmount: lease.purchaseOptionAmount,
    purchaseOptionReasonablyCertain: lease.purchaseOptionReasonablyCertain
  };

  terms[field] = BOOLEAN_FIELDS.has(field)
    ? value === "on" || value === "true"
    : value || null;
  // A site and contact belong to one supplier.
  if (field === "supplierId" && value !== lease.supplierId) {
    terms.supplierLocationId = null;
    terms.supplierContactId = null;
  }
  // Invoicing starts at commencement unless it was moved later.
  if (
    field === "commencementDate" &&
    value &&
    lease.invoiceFromDate === lease.commencementDate
  ) {
    terms.invoiceFromDate = value;
  }

  // The same FormData the new lease form posts, so the same zfd coercion
  // applies.
  const merged = new FormData();
  for (const key of TERM_FIELDS) {
    const term = terms[key];
    if (BOOLEAN_FIELDS.has(key)) {
      if (term) merged.append(key, "on");
    } else if (term !== null && term !== undefined && term !== "") {
      merged.append(key, String(term));
    }
  }

  const validation = await validator(leaseValidator).validate(merged);
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ??
      "These terms are not valid";
    return { error: { message }, data: null };
  }

  const { id: _id, leaseId: _leaseId, ...data } = validation.data;

  const update = await updateLease(client, {
    ...data,
    id,
    companyId,
    updatedBy: userId
  });
  if (update.error) {
    logger.error("lease term update failed", {
      companyId,
      id,
      field,
      error: update.error
    });
    return {
      error: { message: update.error.message || "Failed to update lease" },
      data: null
    };
  }

  if (PAYMENT_TERM_FIELDS.has(field)) {
    try {
      await regenerateLeasePayments(getDatabaseClient(), {
        leaseId: id,
        companyId,
        userId
      });
    } catch (err) {
      logger.error("lease payment rows were not cut again", {
        companyId,
        id,
        field,
        error: err
      });
      return {
        error: {
          message: getErrorMessage(
            err,
            "The term was saved, but the payment rows could not be cut again"
          )
        },
        data: null
      };
    }
  }

  return { error: null, data: update.data };
}
