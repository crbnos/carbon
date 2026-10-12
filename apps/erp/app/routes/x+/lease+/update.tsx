// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  getLease,
  type LeaseDetailField,
  leaseDetailFields,
  leaseDetailsValidator,
  leaseValidator,
  resolveLeaseDates,
  updateLeaseDetails
} from "~/modules/purchasing";
import { updateDraftLease } from "~/modules/purchasing/purchasing.server";
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
  "paymentFrequency",
  "paymentTiming",
  "annualEscalationPercent",
  "discountRate",
  "currencyCode"
] as const;
type TermField = (typeof TERM_FIELDS)[number];

const isTermField = (field: string): field is TermField =>
  (TERM_FIELDS as readonly string[]).includes(field);

const isDetailField = (field: string): field is LeaseDetailField =>
  (leaseDetailFields as readonly string[]).includes(field);

/**
 * One term of a lease, saved from its properties panel.
 *
 * A Draft's terms are validated as a whole (an end date on or after the
 * commencement, invoicing from on or after it), so a single field is never
 * written on its own: the current terms are read, the one field is swapped
 * in, and the merged set runs through the same validator the new lease form
 * uses. `updateDraftLease` saves it and, when a term the payment rows are cut
 * from changed, cuts them again in the same transaction.
 *
 * Once the lease has started only its details stay editable — name, notes,
 * owner and notice date (`leaseDetailFields`); every term the books were
 * measured from changes with Modify.
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
    if (!isDetailField(field)) {
      return {
        error: {
          message:
            "Only the name, notes, owner and notice date of an activated lease can change. Change its terms with Modify."
        },
        data: null
      };
    }
    const validation = await leaseDetailsValidator.safeParseAsync({
      [field]: value || undefined,
      // A notice date is checked against the end date it gives notice of.
      endDate: field === "noticeDate" ? (lease.endDate ?? undefined) : undefined
    });
    if (!validation.success) {
      return {
        error: {
          message:
            validation.error.issues[0]?.message ?? "This value is not valid"
        },
        data: null
      };
    }
    const update = await updateLeaseDetails(client, {
      id,
      companyId,
      updatedBy: userId,
      [field]: validation.data[field] ?? null
    });
    if (update.error) {
      logger.error("lease detail update failed", {
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
    return { error: null, data: update.data };
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
    paymentFrequency: lease.paymentFrequency,
    paymentTiming: lease.paymentTiming,
    annualEscalationPercent: lease.annualEscalationPercent,
    discountRate: lease.discountRate,
    currencyCode: lease.currencyCode
  };

  terms[field] = value || null;
  // A site and contact belong to one supplier.
  if (field === "supplierId" && value !== lease.supplierId) {
    terms.supplierLocationId = null;
    terms.supplierContactId = null;
  }
  // Invoicing starts at commencement unless it was moved later.
  if (
    field === "commencementDate" &&
    value &&
    lease.commencementDate &&
    lease.invoiceFromDate
  ) {
    terms.invoiceFromDate = resolveLeaseDates(
      {
        commencementDate: lease.commencementDate,
        invoiceFromDate: lease.invoiceFromDate
      },
      { commencementDate: value, invoiceFromDate: lease.invoiceFromDate }
    ).invoiceFromDate;
  }

  // The same FormData the new lease form posts, so the same zfd coercion
  // applies.
  const merged = new FormData();
  for (const key of TERM_FIELDS) {
    const term = terms[key];
    if (term !== null && term !== undefined && term !== "") {
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

  try {
    // Refuses a lease that is no longer a Draft.
    await updateDraftLease(getDatabaseClient(), {
      leaseId: id,
      companyId,
      userId,
      terms: data
    });
  } catch (err) {
    logger.error("lease term update failed", {
      companyId,
      id,
      field,
      error: err
    });
    return {
      error: { message: getErrorMessage(err, "Failed to update lease") },
      data: null
    };
  }

  return { error: null, data: { id } };
}
