// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

/** The line fields a setup grid edits one cell at a time, as
 *  `customerContractLineValidator` names them. The billing fields are the
 *  project contract's Lines grid; percents in percent points. */
const LINE_FIELDS = [
  "description",
  "lineItemNumber",
  "projectElementId",
  "fundedAmount",
  "ceilingAmount",
  "feePercent",
  "materialHandlingPercent",
  "revenueType",
  "quantity",
  "rate",
  "rateUnit",
  "discountPercent",
  "taxPercent",
  "startDate",
  "endDate",
  "goLiveDate",
  "revenueMethod",
  "revenueStartDate",
  "revenueEndDate"
] as const;
type LineField = (typeof LINE_FIELDS)[number];

const isLineField = (field: string): field is LineField =>
  (LINE_FIELDS as readonly string[]).includes(field);

/** The fields a cell posts as text that the line holds as a number. */
const NUMBER_FIELDS: readonly LineField[] = [
  "fundedAmount",
  "ceilingAmount",
  "feePercent",
  "materialHandlingPercent",
  "quantity",
  "rate",
  "discountPercent",
  "taxPercent"
];

/**
 * One field of a Draft contract's line, saved from a setup grid cell through
 * `updateContractLine`: the stored line with the one field swapped in, checked
 * as a whole as the line form checks it, and written under the contract's
 * lock. Returns `{ error }`: a cell reverts on error, and nothing flashes. A
 * save another one overtook is a 409.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { api } = await authorize(request, {
    "sales.serviceContracts": "Edit"
  });

  const { id, lineId } = params;
  if (!id || !lineId) {
    return data({ error: "Line not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const field = formData.get("field");
  const value = formData.get("value");
  if (
    typeof field !== "string" ||
    !isLineField(field) ||
    (typeof value !== "string" && value !== null)
  ) {
    return data({ error: "Invalid form data" }, { status: 400 });
  }

  // A cleared cell clears its field.
  const update = await api.sales.updateContractLine({
    id: lineId,
    customerContractId: id,
    [field]: cellValue(field, value)
  });
  if (update.error) {
    return data(
      { error: update.error.message },
      { status: update.error.status }
    );
  }
  return data({ error: null });
}

function cellValue(field: LineField, value: string | null) {
  if (!value) return null;
  return NUMBER_FIELDS.includes(field) ? Number(value) : value;
}
