// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import {
  logTimeValidator,
  projectIssueValidator
} from "~/modules/projects/projects.models";
import {
  coverageOverrideValidator,
  serviceChargeReversalValidator,
  serviceExpenseValidator
} from "~/modules/service/service.models";

function refuse(message: string) {
  return data({ success: false, error: { message } });
}

const MESSAGES = {
  time: "Time logged",
  part: "Part issued",
  expense: "Expense added",
  reclass: "Coverage changed",
  reverse: "Charge reversed"
} as const;

type Intent = keyof typeof MESSAGES;

/**
 * Charges a service order's node, switching on `intent`:
 * - `time`: a Draft timesheet entry on the node (with the visit), posted at
 *   once by `post-timesheet` (`logServiceTime`);
 * - `part`: an issue or a return through `post-project-issue`
 *   (`issueServicePart`);
 * - `expense`: a `projectExpenseEntry`, posted by `post-project-expense`
 *   (`addServiceExpense`);
 * - `reclass`: a charge moved to another coverage, with a reason, through
 *   `reclass-project-coverage` (`reclassServiceCharge`);
 * - `reverse`: a posted time or expense charge reversed, with a reason
 *   (`reverseServiceCharge`).
 * A user without `update: "service"` charges and reverses only on their own
 * open visit (the form's `serviceVisitId`) and never reclasses.
 * A refusal is returned as fetcher data, so the modal shows it and stays open.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const serviceOrderId = input.params.id;

  const formData = await args.request.formData();
  const intent = formData.get("intent");
  if (typeof intent !== "string" || !(intent in MESSAGES)) {
    return refuse("Unknown charge");
  }
  const serviceVisitId = formData.get("serviceVisitId");
  const visitId =
    typeof serviceVisitId === "string" && serviceVisitId
      ? serviceVisitId
      : null;

  const api = await carbon(args.request);
  let result: { error: { message: string } | null };
  // Budget control (Government Contracting 5c): time only warns. The warning
  // goes into the success flash.
  let warning: string | null = null;

  switch (intent as Intent) {
    case "time": {
      const validation = await validator(logTimeValidator).validate(formData);
      if (validation.error) return validationError(validation.error);
      const logged = await api.service.logServiceTime({
        ...validation.data,
        serviceOrderId,
        serviceVisitId: visitId
      });
      warning = logged.data?.warning ?? null;
      result = logged;
      break;
    }
    case "part": {
      const validation = await validator(projectIssueValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      result = await api.service.issueServicePart({
        ...validation.data,
        serviceOrderId,
        serviceVisitId: visitId
      });
      break;
    }
    case "expense": {
      const validation = await validator(serviceExpenseValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      result = await api.service.addServiceExpense({
        ...validation.data,
        serviceVisitId: visitId ?? undefined,
        serviceOrderId
      });
      break;
    }
    case "reverse": {
      const validation = await validator(
        serviceChargeReversalValidator
      ).validate(formData);
      if (validation.error) return validationError(validation.error);
      result = await api.service.reverseServiceCharge({
        ...validation.data,
        serviceOrderId,
        serviceVisitId: visitId
      });
      break;
    }
    case "reclass": {
      const validation = await validator(coverageOverrideValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const projectLedgerId = formData.get("projectLedgerId");
      if (typeof projectLedgerId !== "string" || !projectLedgerId) {
        return refuse("Choose a charge");
      }
      result = await api.service.reclassServiceCharge({
        ...validation.data,
        serviceOrderId,
        projectLedgerId
      });
      break;
    }
  }

  if (result.error) return refuse(result.error.message);
  const message = MESSAGES[intent as Intent];
  return data(
    { success: true, error: null },
    await flash(
      args.request,
      success(warning ? `${message}. ${warning}` : message)
    )
  );
}
