import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { changeNoticeImpactTaskCreateFormValidator } from "~/modules/items";
import { createAuthorizedChangeNoticeImpactTask } from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeNoticeId = params.id;
  if (!changeNoticeId) throw new Error("Could not find id");

  const validation = await validator(
    changeNoticeImpactTaskCreateFormValidator
  ).validate(await request.formData());
  if (validation.error) return validationError(validation.error);

  const {
    decisionId,
    targetType,
    targetId,
    bootstrapRationale,
    name,
    notes: notesJson,
    assignee,
    dueDate
  } = validation.data;

  let normalizedDueDate: string | undefined;
  if (dueDate?.trim()) {
    try {
      normalizedDueDate = parseDate(dueDate.trim()).toString();
    } catch (cause) {
      return data(
        { success: false },
        await flash(request, error(cause, "Invalid due date"))
      );
    }
  }

  let notes: Json | null | undefined;
  if (notesJson) {
    try {
      notes = JSON.parse(notesJson) as Json;
    } catch (cause) {
      return data(
        { success: false },
        await flash(request, error(cause, "Invalid task notes"))
      );
    }
    if (notes === null || typeof notes !== "object" || Array.isArray(notes)) {
      return data(
        { success: false },
        await flash(request, error(null, "Invalid task notes"))
      );
    }
  }

  const result = await createAuthorizedChangeNoticeImpactTask({
    client,
    companyId,
    userId,
    task: {
      changeNoticeId,
      targetType,
      targetId,
      ...(decisionId
        ? {
            decision: {
              decisionId,
              targetType,
              targetId
            }
          }
        : {
            bootstrapDecision: {
              decisionStatus: "Action required",
              rationale: bootstrapRationale ?? ""
            }
          }),
      task: {
        name,
        notes,
        assignee,
        ...(normalizedDueDate ? { dueDate: normalizedDueDate } : {})
      }
    }
  });

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to create Impact task"))
    );
  }

  return { success: true, data: result.data };
}
